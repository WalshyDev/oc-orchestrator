import { createOpencodeServer } from '@opencode-ai/sdk/server'
import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk/v2/client'
import { BrowserWindow } from 'electron'
import { createServer, createConnection } from 'node:net'

export interface RuntimeInfo {
  id: string
  directory: string
  serverUrl: string
  port: number
  client: OpencodeClient
  close: () => void
  startedAt: number
  lastActivityAt: number
  activeSessions: number
  healthy: boolean
}

const HEALTH_CHECK_INTERVAL_MS = 30_000
const HEALTH_CHECK_TIMEOUT_MS = 10_000
const MAX_CONSECUTIVE_FAILURES = 3
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 5_000
const MAX_AUTO_RESTARTS = 2

/**
 * Manages OpenCode server processes and client connections.
 * One server per project directory — sessions are multiplexed within.
 */
class RuntimeManager {
  private runtimes = new Map<string, RuntimeInfo>()
  private nextId = 1
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null
  private consecutiveFailures = new Map<string, number>()
  /** Track auto-restart attempts per directory to prevent restart loops */
  private autoRestartCount = new Map<string, number>()

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
      port,
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
      // Skip runtimes that were removed while we were iterating
      if (!this.runtimes.has(runtimeId)) continue

      const startMs = Date.now()
      try {
        await this.checkHealth(runtime)
        const elapsedMs = Date.now() - startMs

        // Reset failure count on success
        this.consecutiveFailures.set(runtimeId, 0)

        // Log slow but successful health checks as a warning
        if (elapsedMs > 3_000) {
          console.warn(
            `[RuntimeManager] Health check slow for ${runtimeId}: ${elapsedMs}ms (port=${runtime.port})`
          )
        }

        if (!runtime.healthy) {
          runtime.healthy = true
          // Clear restart counter once a runtime for this directory is stable
          this.autoRestartCount.delete(runtime.directory)
          console.log(`[RuntimeManager] Runtime ${runtimeId} is healthy again (${elapsedMs}ms)`)
          this.broadcastToRenderer('runtime:healthy', { id: runtimeId })
        }
      } catch (error) {
        const elapsedMs = Date.now() - startMs
        const failures = (this.consecutiveFailures.get(runtimeId) ?? 0) + 1
        this.consecutiveFailures.set(runtimeId, failures)

        runtime.healthy = false

        // Diagnose whether the port is still open (process alive but slow)
        // or nothing is listening (process dead)
        const portOpen = await this.isPortOpen(runtime.port)
        const uptimeSeconds = Math.round((Date.now() - runtime.startedAt) / 1000)

        console.warn(
          `[RuntimeManager] Health check failed for ${runtimeId} (${failures}/${MAX_CONSECUTIVE_FAILURES}):`,
          `port=${runtime.port} portOpen=${portOpen} uptime=${uptimeSeconds}s elapsed=${elapsedMs}ms dir=${runtime.directory}`,
          error
        )

        this.broadcastToRenderer('runtime:unhealthy', {
          id: runtimeId,
          consecutiveFailures: failures
        })

        if (failures >= MAX_CONSECUTIVE_FAILURES) {
          console.error(
            `[RuntimeManager] Runtime ${runtimeId} disconnected after ${failures} consecutive failures` +
              ` (port=${runtime.port} portOpen=${portOpen})`
          )
          this.broadcastToRenderer('runtime:disconnected', {
            id: runtimeId,
            reason: 'health_check_failures',
            consecutiveFailures: failures
          })

          // Auto-restart if no active sessions and under the restart cap
          await this.tryAutoRestart(runtimeId, runtime, portOpen)
        }
      }
    }
  }

  /**
   * Attempt to auto-restart a runtime that has exceeded the maximum consecutive
   * health check failures. Tracks restart attempts per directory (not runtime ID,
   * since restarts create new IDs) and gives up after MAX_AUTO_RESTARTS to avoid
   * restart loops for persistently broken projects.
   */
  private async tryAutoRestart(
    runtimeId: string,
    runtime: RuntimeInfo,
    portOpen: boolean
  ): Promise<void> {
    const restartsSoFar = this.autoRestartCount.get(runtime.directory) ?? 0

    if (restartsSoFar >= MAX_AUTO_RESTARTS) {
      console.warn(
        `[RuntimeManager] Giving up on auto-restart for ${runtimeId}: ` +
          `already restarted ${restartsSoFar}/${MAX_AUTO_RESTARTS} times for dir=${runtime.directory}`
      )
      this.broadcastToRenderer('runtime:restart-skipped', {
        id: runtimeId,
        reason: 'max_restarts_exceeded',
        restartCount: restartsSoFar,
        directory: runtime.directory
      })
      return
    }

    if (runtime.activeSessions > 0) {
      console.warn(
        `[RuntimeManager] Skipping auto-restart for ${runtimeId}: ` +
          `${runtime.activeSessions} active session(s) — requires manual intervention`
      )
      this.broadcastToRenderer('runtime:restart-skipped', {
        id: runtimeId,
        reason: 'active_sessions',
        activeSessions: runtime.activeSessions
      })
      return
    }

    this.autoRestartCount.set(runtime.directory, restartsSoFar + 1)

    console.log(
      `[RuntimeManager] Auto-restarting ${runtimeId} (attempt ${restartsSoFar + 1}/${MAX_AUTO_RESTARTS}, ` +
        `portOpen=${portOpen}, dir=${runtime.directory})`
    )

    try {
      const newRuntime = await this.restartRuntime(runtimeId)
      if (newRuntime) {
        console.log(
          `[RuntimeManager] Auto-restart succeeded: ${runtimeId} -> ${newRuntime.id} at port ${newRuntime.port}`
        )
        this.broadcastToRenderer('runtime:auto-restarted', {
          oldId: runtimeId,
          newId: newRuntime.id,
          directory: newRuntime.directory
        })
      }
    } catch (error) {
      console.error(`[RuntimeManager] Auto-restart failed for ${runtimeId}:`, error)
      this.broadcastToRenderer('runtime:restart-failed', {
        id: runtimeId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  /**
   * Quick TCP probe to check if anything is listening on the given port.
   * Distinguishes "process dead" (port closed) from "process overloaded" (port open but slow).
   */
  private isPortOpen(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = createConnection({ host: '127.0.0.1', port, timeout: 1_000 })
      socket.once('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.once('timeout', () => {
        socket.destroy()
        resolve(false)
      })
      socket.once('error', () => {
        socket.destroy()
        resolve(false)
      })
    })
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
   * If `manual` is true (user-initiated), resets the auto-restart counter for the
   * directory so auto-restarts can fire again if the new runtime also fails.
   */
  async restartRuntime(runtimeId: string, manual = false): Promise<RuntimeInfo | undefined> {
    const runtime = this.runtimes.get(runtimeId)
    if (!runtime) return undefined

    const { directory } = runtime
    console.log(`[RuntimeManager] Restarting runtime ${runtimeId} for ${directory}`)

    if (manual) {
      this.autoRestartCount.delete(directory)
    }

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
   * Perform a health check using a direct fetch to the session list endpoint.
   * Bypasses the SDK client which adds a custom fetch wrapper (req.timeout = false)
   * that interferes with connection handling and causes spurious timeouts on some
   * runtimes, even though the server itself responds in milliseconds.
   */
  private async checkHealth(runtime: RuntimeInfo): Promise<void> {
    const response = await fetch(`${runtime.serverUrl}/session?limit=1`, {
      method: 'GET',
      headers: { 'x-opencode-directory': runtime.directory },
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS)
    })
    if (!response.ok) {
      throw new Error(`Health check returned status ${response.status} ${response.statusText}`)
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
    this.autoRestartCount.clear()
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
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send(channel, data)
      }
    }
  }
}

export const runtimeManager = new RuntimeManager()
