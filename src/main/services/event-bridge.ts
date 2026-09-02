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
  private streaming = false
  private isReconnecting = false
  private reconnectAttempts = 0
  private currentBackoff = INITIAL_BACKOFF_MS
  private hasStreamed = false

  constructor(
    private runtimeId: string,
    private directory: string,
    private client: OpencodeClient,
    private onEvent?: (event: { type: string; properties: unknown }) => void
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

  /**
   * Guarantee the SSE stream is alive before sending a prompt.
   * If the server disposed and the stream ended, reconnect immediately
   * and wait for it to be ready — otherwise the prompt's response
   * events are lost.
   */
  async ensureStreaming(): Promise<void> {
    if (this.streaming) return
    if (!this.connected) {
      await this.start()
      return
    }
    console.log(`[EventBridge:${this.runtimeId}] Stream dead, reconnecting before prompt`)
    this.isReconnecting = false
    this.reconnectAttempts = 0
    this.currentBackoff = INITIAL_BACKOFF_MS
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
        console.log(`[EventBridge:${this.runtimeId}] Stream available, starting consumer`)
        const reconnected = this.hasStreamed
        this.hasStreamed = true
        this.streaming = true
        this.consumeStream(result.stream as AsyncIterable<{ type: string; properties: unknown }>)
        if (reconnected) {
          this.broadcastToRenderer('event:reconnected', { runtimeId: this.runtimeId })
        }
      } else {
        console.error(`[EventBridge:${this.runtimeId}] No stream in subscribe result! Keys: ${Object.keys(result as object).join(', ')}`)
        this.streaming = false
      }
    } catch (error) {
      this.streaming = false
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

  private eventCount = 0

  private async consumeStream(stream: AsyncIterable<{ type: string; properties: unknown }>): Promise<void> {
    try {
      for await (const event of stream) {
        if (!this.connected) break
        this.eventCount++
        if (this.eventCount <= 5 || this.eventCount % 50 === 0) {
          console.log(`[EventBridge:${this.runtimeId}] Event #${this.eventCount}: ${event.type}`)
        }
        this.forwardEvent(event)
      }
      this.streaming = false
      // The server closed the SSE stream (e.g. server.instance.disposed).
      // Reconnect so events from subsequent prompts aren't lost.
      if (this.connected) {
        console.log(`[EventBridge:${this.runtimeId}] Stream ended after ${this.eventCount} events, reconnecting`)
        this.eventCount = 0
        this.scheduleReconnect()
      }
    } catch (error) {
      this.streaming = false
      if (this.connected) {
        console.error(`[EventBridge:${this.runtimeId}] Stream consumption error after ${this.eventCount} events:`, error)
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
    this.streaming = false
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
    this.onEvent?.(event)
    if (event.type !== 'server.heartbeat') {
      runtimeManager.touchRuntimeActivity(this.runtimeId)
    }

    // Surface error-shaped events in main-process logs so issues like
    // ProviderAuthError ("Unauthorized: ... opencode auth login ...") are
    // visible without digging through the renderer's DevTools console.
    if (event.type.endsWith('.error') || event.type.endsWith('.failed')) {
      console.error(
        `[EventBridge:${this.runtimeId}] ${event.type}:`,
        this.summarizeErrorEvent(event.properties)
      )
    }

    // Also surface TUI error/warning toasts in the terminal. These are how the
    // server reports transient provider failures (e.g. 502 Bad Gateway,
    // overloaded models, rate limits) and they don't end with `.error`, so they
    // would otherwise only be visible in the renderer DevTools.
    if (event.type === 'tui.toast.show') {
      try {
        const toast = (event.properties ?? {}) as Record<string, unknown>
        const variant = String(toast.variant ?? '')
        const title = typeof toast.title === 'string' ? toast.title : ''
        const message = typeof toast.message === 'string' ? toast.message : ''
        const summary = { variant, title, message }
        if (variant === 'error') {
          console.error(`[EventBridge:${this.runtimeId}] TUI toast error:`, summary)
        } else if (variant === 'warning') {
          console.warn(`[EventBridge:${this.runtimeId}] TUI toast warning:`, summary)
        }
      } catch {
        // best-effort logging only
      }
    }

    // Forward all events to the renderer, tagged with the runtime ID
    this.broadcastToRenderer('opencode:event', {
      runtimeId: this.runtimeId,
      directory: this.directory,
      event
    })
  }

  /**
   * Extract the most useful fields from an error-shaped event payload.
   * Matches the SDK shape for session.error (properties.error.{name,data.message})
   * and falls back to the raw payload for unknown shapes.
   */
  private summarizeErrorEvent(properties: unknown): unknown {
    if (!properties || typeof properties !== 'object') return properties

    const props = properties as Record<string, unknown>
    const err = props.error
    if (err && typeof err === 'object') {
      const e = err as Record<string, unknown>
      const data = (e.data as Record<string, unknown> | undefined) ?? {}
      return {
        sessionID: props.sessionID,
        name: e.name,
        providerID: data.providerID,
        message: data.message,
        statusCode: data.statusCode
      }
    }
    return properties
  }

  private broadcastToRenderer(channel: string, data: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send(channel, data)
      }
    }
  }
}
