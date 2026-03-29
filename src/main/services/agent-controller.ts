import { BrowserWindow } from 'electron'
import type { OpencodeClient } from '@opencode-ai/sdk/client'
import { runtimeManager, type RuntimeInfo } from './runtime-manager'
import { EventBridge } from './event-bridge'
import { notificationService, type NotifiableEventType } from './notification-service'
import { database } from './database'
import { workspaceManager } from './workspace-manager'

export interface AgentHandle {
  id: string
  runtimeId: string
  sessionId: string
  directory: string
  projectName: string
  branchName: string
  isWorktree: boolean
  workspaceName: string
  prompt: string
  title: string
  bridge: EventBridge
}

interface PersistedAgentHandle {
  id: string
  sessionId: string
  directory: string
  prompt: string
  title: string
}

const ACTIVE_AGENTS_PREFERENCE_KEY = 'active_agents'
const IDLE_RUNTIME_CHECK_INTERVAL_MS = 60_000
const DEFAULT_RUNTIME_IDLE_TIMEOUT_MS = 15 * 60_000

/**
 * High-level controller for managing individual agent instances.
 * Each agent = one OpenCode session within a runtime (server).
 */
class AgentController {
  private agents = new Map<string, AgentHandle>()
  private bridges = new Map<string, EventBridge>()
  private nextId = 1
  private idleRuntimeTimer: ReturnType<typeof setInterval> | null = null

  async restorePersistedAgents(): Promise<void> {
    const persistedAgents = this.loadPersistedAgents()
    if (persistedAgents.length === 0) return

    for (const persistedAgent of persistedAgents) {
      try {
        const runtime = await this.ensureBridgeForDirectory(persistedAgent.directory)
        const directoryContext = workspaceManager.getDirectoryContext(persistedAgent.directory)
        const handle: AgentHandle = {
          id: persistedAgent.id,
          runtimeId: runtime.id,
          sessionId: persistedAgent.sessionId,
          directory: persistedAgent.directory,
          projectName: directoryContext.repoName,
          branchName: directoryContext.branchName,
          isWorktree: directoryContext.isWorktree,
          workspaceName: directoryContext.workspaceName,
          prompt: persistedAgent.prompt,
          title: persistedAgent.title,
          bridge: this.bridges.get(runtime.id)!
        }

        this.agents.set(handle.id, handle)
        this.bumpNextId(handle.id)
      } catch (error) {
        console.error(`[AgentController] Failed to restore agent ${persistedAgent.id}:`, error)
      }
    }

    this.persistAgents()
  }

  /**
   * Launch a new agent in the given project directory.
   * If no prompt is provided, the session is created but left idle —
   * the user can interact from the detail drawer.
   */
  async launchAgent(options: {
    directory: string
    prompt?: string
    title?: string
  }): Promise<AgentHandle> {
    const { directory, prompt, title } = options

    // Ensure we have a runtime for this directory
    const runtime = await this.ensureBridgeForDirectory(directory)
    const client = runtime.client
    const directoryContext = workspaceManager.getDirectoryContext(directory)
    runtimeManager.touchRuntimeActivity(runtime.id)

    // Derive a session title
    const projectSlug = directory.split('/').pop() ?? 'project'
    const sessionTitle = title ?? (prompt ? prompt.slice(0, 80) : `${projectSlug}-${this.nextId}`)

    // Create a new session
    const sessionResult = await client.session.create({
      headers: { 'x-opencode-directory': directory },
      body: {
        title: sessionTitle
      }
    })

    const session = sessionResult.data
    if (!session) {
      throw new Error('Failed to create session')
    }

    const agentId = `agent-${this.nextId++}`
    const handle: AgentHandle = {
      id: agentId,
      runtimeId: runtime.id,
      sessionId: session.id,
      directory,
      projectName: directoryContext.repoName,
      branchName: directoryContext.branchName,
      isWorktree: directoryContext.isWorktree,
      workspaceName: directoryContext.workspaceName,
      prompt: prompt ?? '',
      title: sessionTitle,
      bridge: this.bridges.get(runtime.id)!
    }

    this.agents.set(agentId, handle)
    this.persistAgents()

    // Only send the initial prompt if one was provided
    if (prompt && prompt.trim()) {
      await client.session.promptAsync({
        headers: { 'x-opencode-directory': directory },
        path: { id: session.id },
        body: {
          parts: [{ type: 'text', text: prompt }]
        }
      })
    }

    this.broadcastToRenderer('agent:launched', {
      id: agentId,
      runtimeId: runtime.id,
      sessionId: session.id,
      directory,
      projectName: handle.projectName,
      branchName: handle.branchName,
      isWorktree: handle.isWorktree,
      workspaceName: handle.workspaceName,
      prompt: prompt ?? '',
      title: sessionTitle
    })

    console.log(`[AgentController] Launched agent ${agentId} (session ${session.id}) in ${directory}`)

    return handle
  }

  /**
   * Send a message to an existing agent session.
   */
  async sendMessage(agentId: string, text: string): Promise<void> {
    const handle = this.agents.get(agentId)
    if (!handle) throw new Error(`Agent ${agentId} not found`)

    const runtime = await this.ensureRuntimeForAgent(handle)
    runtimeManager.touchRuntimeActivity(runtime.id)

    await runtime.client.session.promptAsync({
      headers: { 'x-opencode-directory': handle.directory },
      path: { id: handle.sessionId },
      body: {
        parts: [{ type: 'text', text }]
      }
    })
  }

  /**
   * Respond to a permission request (approve/deny).
   */
  async respondToPermission(agentId: string, permissionId: string, response: 'once' | 'always' | 'reject'): Promise<void> {
    const handle = this.agents.get(agentId)
    if (!handle) throw new Error(`Agent ${agentId} not found`)

    const runtime = await this.ensureRuntimeForAgent(handle)
    runtimeManager.touchRuntimeActivity(runtime.id)

    await runtime.client.postSessionIdPermissionsPermissionId({
      headers: { 'x-opencode-directory': handle.directory },
      path: {
        id: handle.sessionId,
        permissionID: permissionId
      },
      body: { response }
    })
  }

  /**
   * Abort a running agent session.
   */
  async abortAgent(agentId: string): Promise<void> {
    const handle = this.agents.get(agentId)
    if (!handle) throw new Error(`Agent ${agentId} not found`)

    const runtime = await this.ensureRuntimeForAgent(handle)
    runtimeManager.touchRuntimeActivity(runtime.id)

    await runtime.client.session.abort({
      headers: { 'x-opencode-directory': handle.directory },
      path: { id: handle.sessionId }
    })
  }

  /**
   * Fetch messages for an agent's session.
   */
  async getMessages(agentId: string): Promise<unknown> {
    const handle = this.agents.get(agentId)
    if (!handle) throw new Error(`Agent ${agentId} not found`)

    const runtime = await this.ensureRuntimeForAgent(handle)
    runtimeManager.touchRuntimeActivity(runtime.id)

    const result = await runtime.client.session.messages({
      headers: { 'x-opencode-directory': handle.directory },
      path: { id: handle.sessionId }
    })

    return result.data
  }

  /**
   * Fetch session status for all active agents.
   */
  async getSessionStatuses(): Promise<Record<string, { agentId: string; status: unknown }>> {
    const statuses: Record<string, { agentId: string; status: unknown }> = {}

    // Group agents by runtime
    const byRuntime = new Map<string, AgentHandle[]>()
    for (const handle of this.agents.values()) {
      const existing = byRuntime.get(handle.runtimeId) ?? []
      existing.push(handle)
      byRuntime.set(handle.runtimeId, existing)
    }

    for (const [runtimeId, handles] of byRuntime) {
      const runtime = runtimeManager.getRuntime(runtimeId)
      if (!runtime) continue

      try {
        const directory = handles[0].directory
        const result = await runtime.client.session.status({
          headers: { 'x-opencode-directory': directory }
        })

        if (result.data) {
          const sessionStatuses = result.data as Record<string, { type: string }>
          for (const handle of handles) {
            const sessionStatus = sessionStatuses[handle.sessionId]
            if (sessionStatus) {
              statuses[handle.sessionId] = {
                agentId: handle.id,
                status: sessionStatus
              }
            }
          }
        }
      } catch (error) {
        console.error(`[AgentController] Failed to get statuses for runtime ${runtimeId}:`, error)
      }
    }

    return statuses
  }

  /**
   * List all projects known to a runtime.
   */
  async listProjects(runtimeId: string): Promise<unknown> {
    const runtime = runtimeManager.getRuntime(runtimeId)
    if (!runtime) throw new Error(`Runtime ${runtimeId} not found`)

    const result = await runtime.client.project.list()
    return result.data
  }

  getAgent(agentId: string): AgentHandle | undefined {
    return this.agents.get(agentId)
  }

  getAllAgents(): AgentHandle[] {
    return Array.from(this.agents.values())
  }

  /**
   * Remove an agent without aborting it.
   */
  removeAgent(agentId: string): void {
    this.agents.delete(agentId)
    this.persistAgents()
  }

  startIdleRuntimeChecks(): void {
    if (this.idleRuntimeTimer) return

    this.idleRuntimeTimer = setInterval(() => {
      void this.stopIdleRuntimes()
    }, IDLE_RUNTIME_CHECK_INTERVAL_MS)
  }

  /**
   * Stop all agents and bridges.
   */
  stopAll(): void {
    if (this.idleRuntimeTimer) {
      clearInterval(this.idleRuntimeTimer)
      this.idleRuntimeTimer = null
    }

    for (const bridge of this.bridges.values()) {
      bridge.stop()
    }
    this.bridges.clear()
    this.agents.clear()
    runtimeManager.stopAll()
  }

  /**
   * Check agent status and send desktop notification if appropriate.
   */
  checkAndNotify(agentId: string, status: NotifiableEventType, agentName: string, projectName?: string): void {
    notificationService.checkAndNotify(agentId, status, agentName, projectName)

    // Update badge count with number of blocked agents (needs_approval + needs_input)
    const blockedStatuses: NotifiableEventType[] = ['needs_approval', 'needs_input']
    if (blockedStatuses.includes(status)) {
      this.updateBadgeFromAgents()
    }
  }

  /**
   * Recalculate and update the dock badge count based on blocked agents.
   */
  private updateBadgeFromAgents(): void {
    // Badge count is managed externally; callers should invoke updateBadgeCount directly
    // when they have accurate blocked-agent counts from session statuses.
  }

  /**
   * Update the app dock badge with the count of blocked agents.
   */
  updateBadgeCount(blockedCount: number): void {
    notificationService.updateBadgeCount(blockedCount)
  }

  private async ensureBridgeForDirectory(directory: string): Promise<RuntimeInfo> {
    const runtime = await runtimeManager.ensureRuntime(directory)

    if (!this.bridges.has(runtime.id)) {
      const bridge = new EventBridge(runtime.id, directory, runtime.client)
      this.bridges.set(runtime.id, bridge)
      bridge.start()
    }

    return runtime
  }

  private async ensureRuntimeForAgent(handle: AgentHandle): Promise<RuntimeInfo> {
    const existingRuntime = runtimeManager.getRuntime(handle.runtimeId)
    if (existingRuntime) return existingRuntime

    const runtime = await this.ensureBridgeForDirectory(handle.directory)
    handle.runtimeId = runtime.id
    handle.bridge = this.bridges.get(runtime.id)!

    this.broadcastToRenderer('agent:launched', {
      id: handle.id,
      runtimeId: handle.runtimeId,
      sessionId: handle.sessionId,
      directory: handle.directory,
      projectName: handle.projectName,
      branchName: handle.branchName,
      isWorktree: handle.isWorktree,
      workspaceName: handle.workspaceName,
      prompt: handle.prompt,
      title: handle.title
    })

    return runtime
  }

  private async stopIdleRuntimes(): Promise<void> {
    const idleTimeoutMs = Number.parseInt(
      process.env.OC_ORCHESTRATOR_RUNTIME_IDLE_TIMEOUT_MS ?? `${DEFAULT_RUNTIME_IDLE_TIMEOUT_MS}`,
      10
    )

    if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs <= 0) return

    const now = Date.now()

    for (const runtime of runtimeManager.getAllRuntimes()) {
      const idleForMs = now - runtime.lastActivityAt
      if (idleForMs < idleTimeoutMs) continue

      console.log(
        `[AgentController] Stopping idle runtime ${runtime.id} after ${Math.round(idleForMs / 1000)}s of inactivity`
      )
      await this.stopRuntime(runtime.id)
    }
  }

  async stopRuntime(runtimeId: string): Promise<void> {
    const bridge = this.bridges.get(runtimeId)
    if (bridge) {
      bridge.stop()
      this.bridges.delete(runtimeId)
    }

    await runtimeManager.stopRuntime(runtimeId)
  }

  private loadPersistedAgents(): PersistedAgentHandle[] {
    const rawValue = database.getPreference(ACTIVE_AGENTS_PREFERENCE_KEY)
    if (!rawValue) return []

    try {
      const parsedValue = JSON.parse(rawValue) as unknown
      if (!Array.isArray(parsedValue)) return []

      return parsedValue.filter((candidate): candidate is PersistedAgentHandle => {
        if (!candidate || typeof candidate !== 'object') return false

        const agent = candidate as Record<string, unknown>
        return typeof agent.id === 'string'
          && typeof agent.sessionId === 'string'
          && typeof agent.directory === 'string'
          && typeof agent.prompt === 'string'
          && typeof agent.title === 'string'
      })
    } catch (error) {
      console.error('[AgentController] Failed to parse persisted agents:', error)
      return []
    }
  }

  private persistAgents(): void {
    const persistedAgents: PersistedAgentHandle[] = Array.from(this.agents.values()).map((agent) => ({
      id: agent.id,
      sessionId: agent.sessionId,
      directory: agent.directory,
      prompt: agent.prompt,
      title: agent.title
    }))

    database.setPreference(ACTIVE_AGENTS_PREFERENCE_KEY, JSON.stringify(persistedAgents))
  }

  private bumpNextId(agentId: string): void {
    const match = agentId.match(/^agent-(\d+)$/)
    const numericId = match ? Number.parseInt(match[1], 10) : Number.NaN
    if (!Number.isNaN(numericId)) {
      this.nextId = Math.max(this.nextId, numericId + 1)
    }
  }

  private broadcastToRenderer(channel: string, data: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(channel, data)
    }
  }
}

export const agentController = new AgentController()
