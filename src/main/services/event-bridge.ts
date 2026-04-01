import { BrowserWindow } from 'electron'
import type { OpencodeClient } from '@opencode-ai/sdk/v2/client'
import { runtimeManager } from './runtime-manager'

const INITIAL_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 30_000
const BACKOFF_MULTIPLIER = 2
const MAX_JITTER_MS = 1_000
const MAX_RECONNECT_ATTEMPTS = 10

/**
 * Bridges OpenCode SSE events from a server to the renderer process.
 * Subscribes to the event stream and forwards relevant events over IPC.
 * Uses exponential backoff with jitter on reconnection failures.
 */
export class EventBridge {
  private abortController: AbortController | null = null
  private connected = false
  private isReconnecting = false
  private reconnectAttempts = 0
  private currentBackoff = INITIAL_BACKOFF_MS

  constructor(
    private runtimeId: string,
    private directory: string,
    private client: OpencodeClient
  ) {}

  /**
   * Subscribe to the SSE event stream and begin forwarding events.
   * Resolves once the SSE connection is established so callers can
   * safely send prompts knowing the bridge will capture the response.
   */
  async start(): Promise<void> {
    if (this.connected) return

    this.abortController = new AbortController()
    this.connected = true
    this.isReconnecting = false
    this.reconnectAttempts = 0
    this.currentBackoff = INITIAL_BACKOFF_MS

    console.log(`[EventBridge:${this.runtimeId}] Subscribing to events for ${this.directory}`)

    await this.connectStream()
  }

  private async connectStream(): Promise<void> {
    try {
      const result = await this.client.event.subscribe({
        directory: this.directory
      })

      // Connection succeeded — reset backoff state
      this.isReconnecting = false
      this.reconnectAttempts = 0
      this.currentBackoff = INITIAL_BACKOFF_MS

      // The SDK returns an async iterable of SSE events.
      // Consume the stream in the background so start() can resolve
      // immediately after the connection is established.
      if ('stream' in result && result.stream) {
        this.consumeStream(result.stream as AsyncIterable<{ type: string; properties: unknown }>)
      }
    } catch (error) {
      if (this.connected) {
        console.error(`[EventBridge:${this.runtimeId}] Event stream error:`, error)
        this.broadcastToRenderer('event:error', {
          runtimeId: this.runtimeId,
          error: String(error)
        })

        this.scheduleReconnect()
      }
    }
  }

  private async consumeStream(stream: AsyncIterable<{ type: string; properties: unknown }>): Promise<void> {
    try {
      for await (const event of stream) {
        if (!this.connected) break
        this.forwardEvent(event)
      }
    } catch (error) {
      if (this.connected) {
        console.error(`[EventBridge:${this.runtimeId}] Stream consumption error:`, error)
        this.broadcastToRenderer('event:error', {
          runtimeId: this.runtimeId,
          error: String(error)
        })
        this.scheduleReconnect()
      }
    }
  }

  private scheduleReconnect(): void {
    if (!this.connected) return

    this.reconnectAttempts++

    if (this.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      console.error(
        `[EventBridge:${this.runtimeId}] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Giving up.`
      )
      this.broadcastToRenderer('event:reconnect_failed', {
        runtimeId: this.runtimeId,
        attempts: this.reconnectAttempts,
        error: 'Max reconnect attempts exceeded'
      })
      this.connected = false
      return
    }

    this.isReconnecting = true
    const jitter = Math.random() * MAX_JITTER_MS
    const delay = Math.min(this.currentBackoff + jitter, MAX_BACKOFF_MS + MAX_JITTER_MS)

    console.log(
      `[EventBridge:${this.runtimeId}] Reconnecting in ${Math.round(delay)}ms ` +
      `(attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`
    )

    this.broadcastToRenderer('event:reconnecting', {
      runtimeId: this.runtimeId,
      attempt: this.reconnectAttempts,
      maxAttempts: MAX_RECONNECT_ATTEMPTS,
      delayMs: Math.round(delay)
    })

    setTimeout(() => {
      if (this.connected) {
        this.connectStream()
      }
    }, delay)

    // Increase backoff for next attempt
    this.currentBackoff = Math.min(this.currentBackoff * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS)
  }

  stop(): void {
    this.connected = false
    this.isReconnecting = false
    this.reconnectAttempts = 0
    this.currentBackoff = INITIAL_BACKOFF_MS
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
    console.log(`[EventBridge:${this.runtimeId}] Stopped`)
  }

  getConnectionState(): { connected: boolean; isReconnecting: boolean; reconnectAttempts: number } {
    return {
      connected: this.connected,
      isReconnecting: this.isReconnecting,
      reconnectAttempts: this.reconnectAttempts
    }
  }

  private forwardEvent(event: { type: string; properties: unknown }): void {
    if (event.type !== 'server.heartbeat') {
      runtimeManager.touchRuntimeActivity(this.runtimeId)
    }

    // Forward all events to the renderer, tagged with the runtime ID
    this.broadcastToRenderer('opencode:event', {
      runtimeId: this.runtimeId,
      directory: this.directory,
      event
    })
  }

  private broadcastToRenderer(channel: string, data: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(channel, data)
    }
  }
}
