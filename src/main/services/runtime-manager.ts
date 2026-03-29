import { createOpencodeServer } from '@opencode-ai/sdk/server'
import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk/client'
import { BrowserWindow } from 'electron'
import { createServer } from 'node:net'

export interface RuntimeInfo {
  id: string
  directory: string
  serverUrl: string
  client: OpencodeClient
  close: () => void
  startedAt: number
  lastActivityAt: number
  activeSessions: number
  healthy: boolean
}

const HEALTH_CHECK_INTERVAL_MS = 30_000
const MAX_CONSECUTIVE_FAILURES = 3
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 5_000

/**
 * Manages OpenCode server processes and client connections.
 * One server per project directory — sessions are multiplexed within.
 */
class RuntimeManager {
  private runtimes = new Map<string, RuntimeInfo>()
  private nextId = 1
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null
  private consecutiveFailures = new Map<string, number>()

  /**
   * Start (or reuse) an OpenCode server for a project directory.
   * Returns a RuntimeInfo with the client ready to use.
   */
  async ensureRuntime(directory: string): Promise<RuntimeInfo> {
    const existing = this.findByDirectory(directory)
    if (existing) return existing

    console.log(`[RuntimeManager] Starting server for ${directory}`)

    const port = await this.getAvailablePort()

    const server = await createOpencodeServer({
      port,
      timeout: 15000
    })

    const client = createOpencodeClient({
      baseUrl: server.url,
      directory
    })

    const runtimeId = `runtime-${this.nextId++}`
    const runtime: RuntimeInfo = {
      id: runtimeId,
      directory,
      serverUrl: server.url,
      client,
      close: server.close,
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      activeSessions: 0,
      healthy: true
    }

    this.runtimes.set(runtimeId, runtime)
    this.consecutiveFailures.set(runtimeId, 0)
    console.log(`[RuntimeManager] Server ready at ${server.url} for ${directory}`)

    this.broadcastToRenderer('runtime:started', {
      id: runtimeId,
      directory,
      serverUrl: server.url
    })

    return runtime
  }

  /**
   * Start periodic health checks for all active runtimes.
   * Checks every 30 seconds; after 3 consecutive failures emits runtime:disconnected.
   */
  startHealthChecks(): void {
    if (this.healthCheckTimer) return

    console.log('[RuntimeManager] Starting periodic health checks')
    this.healthCheckTimer = setInterval(() => {
      this.runHealthChecks()
    }, HEALTH_CHECK_INTERVAL_MS)
  }

  /**
   * Stop periodic health checks.
   */
  stopHealthChecks(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = null
    }
  }

  private async runHealthChecks(): Promise<void> {
    for (const [runtimeId, runtime] of this.runtimes) {
      try {
        await this.checkHealth(runtime)

        // Reset failure count on success
        this.consecutiveFailures.set(runtimeId, 0)

        if (!runtime.healthy) {
          runtime.healthy = true
          console.log(`[RuntimeManager] Runtime ${runtimeId} is healthy again`)
          this.broadcastToRenderer('runtime:healthy', { id: runtimeId })
        }
      } catch (error) {
        const failures = (this.consecutiveFailures.get(runtimeId) ?? 0) + 1
        this.consecutiveFailures.set(runtimeId, failures)

        runtime.healthy = false
        console.warn(
          `[RuntimeManager] Health check failed for ${runtimeId} (${failures}/${MAX_CONSECUTIVE_FAILURES}):`,
          error
        )

        this.broadcastToRenderer('runtime:unhealthy', {
          id: runtimeId,
          consecutiveFailures: failures
        })

        if (failures >= MAX_CONSECUTIVE_FAILURES) {
          console.error(
            `[RuntimeManager] Runtime ${runtimeId} disconnected after ${failures} consecutive failures`
          )
          this.broadcastToRenderer('runtime:disconnected', {
            id: runtimeId,
            reason: 'health_check_failures',
            consecutiveFailures: failures
          })
        }
      }
    }
  }

  /**
   * Handle an unexpected runtime crash. Broadcasts the event to the renderer.
   */
  handleCrash(runtimeId: string, exitCode?: number): void {
    const runtime = this.runtimes.get(runtimeId)
    if (!runtime) return

    console.error(`[RuntimeManager] Runtime ${runtimeId} crashed (exit code: ${exitCode ?? 'unknown'})`)

    runtime.healthy = false
    this.broadcastToRenderer('runtime:crashed', {
      id: runtimeId,
      directory: runtime.directory,
      exitCode
    })
  }

  /**
   * Restart a runtime by stopping it gracefully and re-creating it.
   */
  async restartRuntime(runtimeId: string): Promise<RuntimeInfo | undefined> {
    const runtime = this.runtimes.get(runtimeId)
    if (!runtime) return undefined

    const { directory } = runtime
    console.log(`[RuntimeManager] Restarting runtime ${runtimeId} for ${directory}`)

    await this.stopRuntime(runtimeId)
    return this.ensureRuntime(directory)
  }

  /**
   * Increment or decrement the active session count for a runtime.
   */
  updateSessionCount(runtimeId: string, delta: number): void {
    const runtime = this.runtimes.get(runtimeId)
    if (!runtime) return
    runtime.activeSessions = Math.max(0, runtime.activeSessions + delta)
    runtime.lastActivityAt = Date.now()
  }

  touchRuntimeActivity(runtimeId: string): void {
    const runtime = this.runtimes.get(runtimeId)
    if (!runtime) return
    runtime.lastActivityAt = Date.now()
  }

  /**
   * Stop a runtime by ID with graceful shutdown (5s timeout before force-kill).
   */
  async stopRuntime(runtimeId: string): Promise<void> {
    const runtime = this.runtimes.get(runtimeId)
    if (!runtime) return

    console.log(`[RuntimeManager] Stopping runtime ${runtimeId} (graceful shutdown)`)

    // Try graceful shutdown with a timeout
    try {
      await Promise.race([
        this.gracefulShutdown(runtime),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('Graceful shutdown timed out')), GRACEFUL_SHUTDOWN_TIMEOUT_MS)
        )
      ])
      console.log(`[RuntimeManager] Runtime ${runtimeId} shut down gracefully`)
    } catch (error) {
      console.warn(`[RuntimeManager] Graceful shutdown failed for ${runtimeId}, force-closing:`, error)
      runtime.close()
    }

    this.runtimes.delete(runtimeId)
    this.consecutiveFailures.delete(runtimeId)

    this.broadcastToRenderer('runtime:stopped', { id: runtimeId })
  }

  private async gracefulShutdown(runtime: RuntimeInfo): Promise<void> {
    // Verify the server is still reachable before graceful close
    try {
      await this.checkHealth(runtime)
      runtime.close()
    } catch {
      // If health check fails, just force-close
      runtime.close()
    }
  }

  /**
   * Perform a lightweight HTTP health check against the runtime's server URL.
   * Throws if the server is unreachable or returns a non-OK status.
   */
  private async checkHealth(runtime: RuntimeInfo): Promise<void> {
    const response = await fetch(`${runtime.serverUrl}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5_000)
    })
    if (!response.ok) {
      throw new Error(`Health check returned status ${response.status}`)
    }
  }

  /**
   * Stop all runtimes (app shutdown).
   */
  stopAll(): void {
    this.stopHealthChecks()
    for (const [runtimeId, runtime] of this.runtimes) {
      console.log(`[RuntimeManager] Stopping runtime ${runtimeId}`)
      runtime.close()
    }
    this.runtimes.clear()
    this.consecutiveFailures.clear()
  }

  getRuntime(runtimeId: string): RuntimeInfo | undefined {
    return this.runtimes.get(runtimeId)
  }

  findByDirectory(directory: string): RuntimeInfo | undefined {
    for (const runtime of this.runtimes.values()) {
      if (runtime.directory === directory) return runtime
    }
    return undefined
  }

  getAllRuntimes(): RuntimeInfo[] {
    return Array.from(this.runtimes.values())
  }

  private async getAvailablePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const probeServer = createServer()

      probeServer.once('error', (error) => {
        reject(error)
      })

      probeServer.listen(0, '127.0.0.1', () => {
        const address = probeServer.address()
        if (!address || typeof address === 'string') {
          probeServer.close(() => reject(new Error('Failed to resolve an available port')))
          return
        }

        const { port } = address
        probeServer.close((error) => {
          if (error) {
            reject(error)
            return
          }

          resolve(port)
        })
      })
    })
  }

  private broadcastToRenderer(channel: string, data: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(channel, data)
    }
  }
}

export const runtimeManager = new RuntimeManager()
