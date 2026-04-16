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
const MAX_CONSECUTIVE_FAILURES = 3
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 5_000
const AUTO_RESTART_COOLDOWN_MS = 10_000

/**
 * Manages OpenCode server processes and client connections.
 * One server per project directory — sessions are multiplexed within.
 */
class RuntimeManager {
  private runtimes = new Map<string, RuntimeInfo>()
  private nextId = 1
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null
  private consecutiveFailures = new Map<string, number>()
  private lastAutoRestart = new Map<string, number>()
  private pendingEnsure = new Map<string, Promise<RuntimeInfo>>()

  /**
   * Start (or reuse) an OpenCode server for a project directory.
   * Returns a RuntimeInfo with the client ready to use.
   */
  async ensureRuntime(directory: string): Promise<RuntimeInfo> {
    const existing = this.findByDirectory(directory)
    if (existing) return existing

    // Deduplicate concurrent calls for the same directory.
    const pending = this.pendingEnsure.get(directory)
    if (pending) return pending

    const promise = this.spawnRuntime(directory)
    this.pendingEnsure.set(directory, promise)

    try {
      return await promise
    } finally {
      this.pendingEnsure.delete(directory)
    }
  }

  private async spawnRuntime(directory: string): Promise<RuntimeInfo> {
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
    const entries = Array.from(this.runtimes.entries())

    await Promise.all(
      entries.map(async ([runtimeId, runtime]) => {
        // Skip runtimes that were removed while we were iterating
        if (!this.runtimes.has(runtimeId)) return

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

          // Diagnose whether the port is still open (process alive but slow)
          // or nothing is listening (process dead)
          const portOpen = await this.isPortOpen(runtime.port)
          const uptimeSeconds = Math.round((Date.now() - runtime.startedAt) / 1000)

          console.warn(
            `[RuntimeManager] Health check failed for ${runtimeId} (${failures}/${MAX_CONSECUTIVE_FAILURES}):`,
            `port=${runtime.port} portOpen=${portOpen} uptime=${uptimeSeconds}s dir=${runtime.directory}`,
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

            // Auto-restart if no active sessions and not recently restarted
            await this.tryAutoRestart(runtimeId, runtime, portOpen)
          }
        }
      })
    )
  }

  /**
   * Attempt to auto-restart a runtime that has exceeded the maximum consecutive
   * health check failures. Skips restart if the runtime has active sessions or
   * was recently restarted (within the cooldown period).
   */
  private async tryAutoRestart(
    runtimeId: string,
    runtime: RuntimeInfo,
    portOpen: boolean
  ): Promise<void> {
    const lastRestart = this.lastAutoRestart.get(runtimeId) ?? 0
    const sinceLastRestart = Date.now() - lastRestart

    if (sinceLastRestart < AUTO_RESTART_COOLDOWN_MS) {
      console.warn(
        `[RuntimeManager] Skipping auto-restart for ${runtimeId}: ` +
          `last restart was ${Math.round(sinceLastRestart / 1000)}s ago (cooldown: ${AUTO_RESTART_COOLDOWN_MS / 1000}s)`
      )
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

    console.log(
      `[RuntimeManager] Auto-restarting ${runtimeId} (portOpen=${portOpen}, dir=${runtime.directory})`
    )
    this.lastAutoRestart.set(runtimeId, Date.now())

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
    this.lastAutoRestart.delete(runtimeId)

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
    this.lastAutoRestart.clear()
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
