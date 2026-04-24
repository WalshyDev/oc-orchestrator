import { ipcMain, dialog, shell } from 'electron'
import { execFile } from 'child_process'
import os from 'os'
import { agentController } from './services/agent-controller'
import { runtimeManager } from './services/runtime-manager'
import { workspaceManager } from './services/workspace-manager'
import { database } from './services/database'
import { notificationService, type NotifiableEventType } from './services/notification-service'
import { getAppVersion } from './version'

interface Attachment {
  id?: string
  mime: string
  dataUrl: string
  filename?: string
}

/**
 * Log an IPC handler error with rich details.
 *
 * Node's default formatting of Error objects shows name/message/stack, but SDK
 * errors from @opencode-ai/sdk often stash useful context on `.cause`,
 * `.response.data`, or `.body` which isn't printed. Surface those too so the
 * `npm run dev` terminal contains everything needed to diagnose the failure.
 */
function logIpcError(channel: string, error: unknown, context?: Record<string, unknown>): void {
  const err = error as (Error & {
    cause?: unknown
    status?: number
    statusText?: string
    body?: unknown
    response?: { status?: number; statusText?: string; data?: unknown }
  }) | null | undefined

  const details: Record<string, unknown> = {}
  if (context) Object.assign(details, context)
  if (err?.name) details.name = err.name
  if (err?.message) details.message = err.message
  const status = err?.status ?? err?.response?.status
  if (status !== undefined) details.status = status
  const statusText = err?.statusText ?? err?.response?.statusText
  if (statusText !== undefined) details.statusText = statusText
  const body = err?.body ?? err?.response?.data
  if (body !== undefined) details.body = body
  if (err?.cause !== undefined) details.cause = err.cause

  console.error(`[IPC] ${channel} failed:`, details)
  if (err?.stack) console.error(err.stack)
}

/**
 * Register all IPC handlers for renderer <-> main communication.
 */
export function registerIpcHandlers(): void {
  // ── Agent Lifecycle ──

  ipcMain.handle('agent:launch', async (_event, options: {
    directory: string
    prompt?: string
    title?: string
    model?: string
    attachments?: Attachment[]
  }) => {
    try {
      const handle = await agentController.launchAgent(options)
      return {
        ok: true,
        data: {
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
        }
      }
    } catch (error) {
      logIpcError('agent:launch', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:send-message', async (_event, agentId: string, text: string, agent?: string, attachments?: Attachment[]) => {
    try {
      await agentController.sendMessage(agentId, text, agent, attachments)
      return { ok: true }
    } catch (error) {
      logIpcError('agent:send-message', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:respond-permission', async (_event, agentId: string, permissionId: string, response: 'once' | 'always' | 'reject') => {
    try {
      await agentController.respondToPermission(agentId, permissionId, response)
      return { ok: true }
    } catch (error) {
      logIpcError('agent:respond-permission', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:reply-question', async (_event, agentId: string, requestId: string, answers: string[][]) => {
    try {
      await agentController.replyToQuestion(agentId, requestId, answers)
      return { ok: true }
    } catch (error) {
      logIpcError('agent:reply-question', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:reject-question', async (_event, agentId: string, requestId: string) => {
    try {
      await agentController.rejectQuestion(agentId, requestId)
      return { ok: true }
    } catch (error) {
      logIpcError('agent:reject-question', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:list-questions', async () => {
    try {
      const questions = await agentController.getAllPendingQuestions()
      return { ok: true, data: questions }
    } catch (error) {
      logIpcError('agent:list-questions', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:list-permissions', async () => {
    try {
      const permissions = await agentController.getAllPendingPermissions()
      return { ok: true, data: permissions }
    } catch (error) {
      logIpcError('agent:list-permissions', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:abort', async (_event, agentId: string) => {
    try {
      await agentController.abortAgent(agentId)
      return { ok: true }
    } catch (error) {
      logIpcError('agent:abort', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:remove', async (_event, agentId: string) => {
    try {
      await agentController.removeAgent(agentId)
      return { ok: true }
    } catch (error) {
      logIpcError('agent:remove', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:reset-session', async (_event, agentId: string, prompt?: string) => {
    try {
      const handle = await agentController.resetSession(agentId, prompt)
      return {
        ok: true,
        data: {
          id: handle.id,
          sessionId: handle.sessionId,
          directory: handle.directory,
          prompt: handle.prompt,
          title: handle.title
        }
      }
    } catch (error) {
      logIpcError('agent:reset-session', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:list-commands', async (_event, agentId: string) => {
    try {
      const commands = await agentController.listCommands(agentId)
      return { ok: true, data: commands }
    } catch (error) {
      logIpcError('agent:list-commands', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:execute-command', async (_event, agentId: string, command: string, args: string) => {
    try {
      const result = await agentController.executeCommand(agentId, command, args)
      return { ok: true, data: result }
    } catch (error) {
      logIpcError('agent:execute-command', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:get-config', async (_event, agentId: string) => {
    try {
      const config = await agentController.getConfig(agentId)
      return { ok: true, data: config }
    } catch (error) {
      logIpcError('agent:get-config', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:update-config', async (_event, agentId: string, config: Record<string, unknown>) => {
    try {
      const result = await agentController.updateConfig(agentId, config)
      return { ok: true, data: result }
    } catch (error) {
      logIpcError('agent:update-config', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:get-providers', async (_event, agentId: string) => {
    try {
      const providers = await agentController.getProviders(agentId)
      return { ok: true, data: providers }
    } catch (error) {
      logIpcError('agent:get-providers', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:mcp-status', async (_event, agentId: string) => {
    try {
      const status = await agentController.getMcpStatus(agentId)
      return { ok: true, data: status }
    } catch (error) {
      logIpcError('agent:mcp-status', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:mcp-connect', async (_event, agentId: string, name: string) => {
    try {
      const result = await agentController.connectMcp(agentId, name)
      return { ok: true, data: result }
    } catch (error) {
      logIpcError('agent:mcp-connect', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:mcp-disconnect', async (_event, agentId: string, name: string) => {
    try {
      const result = await agentController.disconnectMcp(agentId, name)
      return { ok: true, data: result }
    } catch (error) {
      logIpcError('agent:mcp-disconnect', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:compact', async (_event, agentId: string) => {
    console.log('[IPC] agent:compact called', { agentId })
    try {
      const result = await agentController.compactSession(agentId)
      console.log('[IPC] agent:compact succeeded', { agentId })
      return { ok: true, data: result }
    } catch (error) {
      logIpcError('agent:compact', error, { agentId })
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:share', async (_event, agentId: string) => {
    try {
      const result = await agentController.shareSession(agentId)
      return { ok: true, data: result }
    } catch (error) {
      logIpcError('agent:share', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:list-agent-configs', async (_event, agentId: string) => {
    try {
      const agents = await agentController.listAgentConfigs(agentId)
      return { ok: true, data: agents }
    } catch (error) {
      logIpcError('agent:list-agent-configs', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:list-tools', async (_event, agentId: string) => {
    try {
      const tools = await agentController.listTools(agentId)
      return { ok: true, data: tools }
    } catch (error) {
      logIpcError('agent:list-tools', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:send-message-with-model', async (_event, agentId: string, text: string, providerID: string, modelID: string, attachments?: Attachment[]) => {
    try {
      await agentController.sendMessageWithModel(agentId, text, providerID, modelID, attachments)
      return { ok: true }
    } catch (error) {
      logIpcError('agent:send-message-with-model', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:get-messages', async (_event, agentId: string) => {
    try {
      const messages = await agentController.getMessages(agentId)
      return { ok: true, data: messages }
    } catch (error) {
      logIpcError('agent:get-messages', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('session:list', async (_event, directory: string) => {
    try {
      const sessions = await agentController.listSessions(directory)
      return { ok: true, data: sessions }
    } catch (error) {
      logIpcError('session:list', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('session:list-by-project', async (_event, projectDirectory: string) => {
    try {
      const sessions = await agentController.listSessionsByProject(projectDirectory)
      return { ok: true, data: sessions }
    } catch (error) {
      logIpcError('session:list-by-project', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('session:fork', async (_event, options: {
    sourceSessionId: string
    targetDirectory: string
  }) => {
    try {
      const result = await agentController.forkSession(options)
      return { ok: true, data: result }
    } catch (error) {
      logIpcError('session:fork', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:resume', async (_event, options: {
    directory: string
    sessionId: string
    title?: string
  }) => {
    try {
      const handle = await agentController.resumeAgent(options)
      return {
        ok: true,
        data: {
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
        }
      }
    } catch (error) {
      logIpcError('agent:resume', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:restored', () => {
    return { ok: true, data: agentController.restored }
  })

  ipcMain.handle('agent:list', async () => {
    const agents = agentController.getAllAgents()
    return {
      ok: true,
      data: agents.map((agent) => ({
        id: agent.id,
        runtimeId: agent.runtimeId,
        sessionId: agent.sessionId,
        directory: agent.directory,
        projectName: agent.projectName,
        branchName: agent.branchName,
        isWorktree: agent.isWorktree,
        workspaceName: agent.workspaceName,
        prompt: agent.prompt,
        title: agent.title,
        displayName: agent.displayName,
        taskSummary: agent.taskSummary,
        persistedStatus: agent.persistedStatus,
        labelIds: agent.labelIds ?? [],
        prUrl: agent.prUrl
      }))
    }
  })

  ipcMain.handle('agent:update-meta', async (_event, agentId: string, meta: { displayName?: string; taskSummary?: string; persistedStatus?: string; labelIds?: string[]; prUrl?: string }) => {
    try {
      agentController.updateAgentMeta(agentId, meta)
      return { ok: true }
    } catch (error) {
      logIpcError('agent:update-meta', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:statuses', async () => {
    try {
      const statuses = await agentController.getSessionStatuses()
      return { ok: true, data: statuses }
    } catch (error) {
      logIpcError('agent:statuses', error)
      return { ok: false, error: String(error) }
    }
  })

  // ── Runtime Management ──

  ipcMain.handle('runtime:list', async () => {
    const runtimes = runtimeManager.getAllRuntimes()
    return {
      ok: true,
      data: runtimes.map((runtime) => ({
        id: runtime.id,
        directory: runtime.directory,
        serverUrl: runtime.serverUrl
      }))
    }
  })

  ipcMain.handle('runtime:stop', async (_event, runtimeId: string) => {
    try {
      await agentController.stopRuntime(runtimeId)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('runtime:providers', async () => {
    try {
      const data = await agentController.getProvidersFromAnyRuntime()
      return { ok: true, data }
    } catch (error) {
      logIpcError('runtime:providers', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('runtime:commands', async () => {
    try {
      const data = await agentController.listCommandsFromAnyRuntime()
      return { ok: true, data }
    } catch (error) {
      logIpcError('runtime:commands', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('runtime:agent-configs', async () => {
    try {
      const data = await agentController.listAgentConfigsFromAnyRuntime()
      return { ok: true, data }
    } catch (error) {
      logIpcError('runtime:agent-configs', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('runtime:config', async () => {
    try {
      const data = await agentController.getConfigFromAnyRuntime()
      return { ok: true, data }
    } catch (error) {
      logIpcError('runtime:config', error)
      return { ok: false, error: String(error) }
    }
  })

  // ── Dialog ──

  ipcMain.handle('dialog:select-directory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select Project Directory'
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, error: 'canceled' }
    }

    return { ok: true, data: result.filePaths[0] }
  })

  // ── Workspace Operations ──

  ipcMain.handle('workspace:validate-git', async (_event, directory: string) => {
    try {
      const isRepo = workspaceManager.isGitRepo(directory)
      return { ok: true, data: isRepo }
    } catch (error) {
      logIpcError('workspace:validate-git', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('workspace:root', async () => {
    try {
      const root = workspaceManager.getWorktreeRoot()
      return { ok: true, data: root }
    } catch (error) {
      logIpcError('workspace:root', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('workspace:repo-root', async (_event, directory: string) => {
    try {
      const repoRoot = workspaceManager.getRepoRoot(directory)
      return { ok: true, data: repoRoot }
    } catch (error) {
      logIpcError('workspace:repo-root', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('workspace:common-repo-root', async (_event, directory: string) => {
    try {
      const repoRoot = await workspaceManager.getCommonRepoRoot(directory)
      return { ok: true, data: repoRoot }
    } catch (error) {
      logIpcError('workspace:common-repo-root', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('workspace:create', async (_event, options: {
    repoRoot: string
    projectSlug: string
    taskSlug: string
  }) => {
    try {
      const result = workspaceManager.createWorktree(options.repoRoot, options.projectSlug, options.taskSlug)
      return { ok: true, data: result }
    } catch (error) {
      logIpcError('workspace:create', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('workspace:create-fresh', async (_event, options: {
    repoRoot: string
    projectSlug: string
    taskSlug: string
    baseRef?: string
  }) => {
    try {
      const result = workspaceManager.createFreshWorktree(options.repoRoot, options.projectSlug, options.taskSlug, options.baseRef)
      return { ok: true, data: result }
    } catch (error) {
      logIpcError('workspace:create-fresh', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('workspace:default-branch', async (_event, repoRoot: string) => {
    try {
      const branch = workspaceManager.getDefaultBranch(repoRoot)
      return { ok: true, data: branch }
    } catch (error) {
      logIpcError('workspace:default-branch', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('workspace:remove', async (_event, options: {
    repoRoot: string
    worktreePath: string
  }) => {
    try {
      await workspaceManager.removeWorktree(options.repoRoot, options.worktreePath)
      return { ok: true }
    } catch (error) {
      logIpcError('workspace:remove', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('workspace:list', async (_event, repoRoot: string) => {
    try {
      const worktrees = workspaceManager.listWorktrees(repoRoot)
      return { ok: true, data: worktrees }
    } catch (error) {
      logIpcError('workspace:list', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('workspace:status', async (_event, worktreePath: string) => {
    try {
      const status = workspaceManager.getWorktreeStatus(worktreePath)
      return { ok: true, data: status }
    } catch (error) {
      logIpcError('workspace:status', error)
      return { ok: false, error: String(error) }
    }
  })

  // ── Database: Projects ──

  ipcMain.handle('db:projects:list', async () => {
    try {
      const projects = database.getAllProjects()
      return { ok: true, data: projects }
    } catch (error) {
      logIpcError('db:projects:list', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('db:projects:create', async (_event, options: {
    name: string
    repoRoot: string
  }) => {
    try {
      const project = database.createProject(options.name, options.repoRoot)
      return { ok: true, data: project }
    } catch (error) {
      logIpcError('db:projects:create', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('db:projects:ensure', async (_event, options: {
    name: string
    repoRoot: string
  }) => {
    try {
      const project = database.ensureProject(options.name, options.repoRoot)
      return { ok: true, data: project }
    } catch (error) {
      logIpcError('db:projects:ensure', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('db:projects:delete', async (_event, projectId: string) => {
    try {
      const deleted = database.deleteProject(projectId)
      return { ok: true, data: deleted }
    } catch (error) {
      logIpcError('db:projects:delete', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('db:projects:update-settings', async (_event, options: {
    repoRoot: string
    settings: { default_branch?: string | null; fresh_worktree?: boolean }
  }) => {
    try {
      const project = database.updateProjectSettings(options.repoRoot, options.settings)
      if (!project) {
        return { ok: false, error: `No project found for repo root: ${options.repoRoot}` }
      }
      return { ok: true, data: project }
    } catch (error) {
      logIpcError('db:projects:update-settings', error)
      return { ok: false, error: String(error) }
    }
  })

  // ── Database: Preferences ──

  ipcMain.handle('db:preferences:get', async (_event, key: string) => {
    try {
      const value = database.getPreference(key)
      return { ok: true, data: value }
    } catch (error) {
      logIpcError('db:preferences:get', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('db:preferences:set', async (_event, key: string, value: string) => {
    try {
      database.setPreference(key, value)
      return { ok: true }
    } catch (error) {
      logIpcError('db:preferences:set', error)
      return { ok: false, error: String(error) }
    }
  })

  // ── Database: Custom Labels ──

  ipcMain.handle('db:labels:list', async () => {
    try {
      const labels = database.getAllCustomLabels()
      return { ok: true, data: labels }
    } catch (error) {
      logIpcError('db:labels:list', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('db:labels:create', async (_event, options: { id: string; name: string; colorKey: string }) => {
    try {
      const label = database.createCustomLabel(options.id, options.name, options.colorKey)
      return { ok: true, data: label }
    } catch (error) {
      logIpcError('db:labels:create', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('db:labels:update', async (_event, options: { id: string; name: string; colorKey: string }) => {
    try {
      const label = database.updateCustomLabel(options.id, options.name, options.colorKey)
      return { ok: true, data: label }
    } catch (error) {
      logIpcError('db:labels:update', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('db:labels:delete', async (_event, labelId: string) => {
    try {
      const deleted = database.deleteCustomLabel(labelId)
      return { ok: true, data: deleted }
    } catch (error) {
      logIpcError('db:labels:delete', error)
      return { ok: false, error: String(error) }
    }
  })

  // ── Notifications ──

  ipcMain.handle('agent:notify-status', async (_event, agentId: string, status: string, agentName: string, projectName?: string, preview?: string) => {
    try {
      const notifiable = ['needs_approval', 'needs_input', 'errored', 'completed', 'disconnected']
      if (notifiable.includes(status)) {
        agentController.checkAndNotify(agentId, status as NotifiableEventType, agentName, projectName, preview)
      }
      return { ok: true }
    } catch (error) {
      logIpcError('agent:notify-status', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('notifications:get-preferences', async () => {
    try {
      const preferences = notificationService.getPreferences()
      return { ok: true, data: preferences }
    } catch (error) {
      logIpcError('notifications:get-preferences', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('notifications:set-preference', async (_event, eventType: NotifiableEventType, enabled: boolean) => {
    try {
      notificationService.setPreference(eventType, enabled)
      return { ok: true }
    } catch (error) {
      logIpcError('notifications:set-preference', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('notifications:get-sound-enabled', async () => {
    try {
      return { ok: true, data: notificationService.getSoundEnabled() }
    } catch (error) {
      logIpcError('notifications:get-sound-enabled', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('notifications:set-sound-enabled', async (_event, enabled: boolean) => {
    try {
      notificationService.setSoundEnabled(enabled)
      return { ok: true }
    } catch (error) {
      logIpcError('notifications:set-sound-enabled', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('notifications:get-pending-agent', async () => {
    try {
      const agentId = notificationService.getPendingAgentId()
      return { ok: true, data: agentId }
    } catch (error) {
      logIpcError('notifications:get-pending-agent', error)
      return { ok: false, error: String(error) }
    }
  })

  // ── App Info ──

  ipcMain.handle('app:version', () => {
    return { ok: true, data: getAppVersion() }
  })

  ipcMain.handle('app:home-directory', () => {
    return { ok: true, data: os.homedir() }
  })

  ipcMain.handle('app:set-badge-count', async (_event, count: number) => {
    try {
      const safeCount = Math.max(0, Math.floor(count))
      notificationService.updateBadgeCount(safeCount)
      return { ok: true }
    } catch (error) {
      logIpcError('app:set-badge-count', error)
      return { ok: false, error: String(error) }
    }
  })

  // ── Shell Integration ──

  /** Promisified execFile — avoids shell interpretation of arguments */
  const run = (cmd: string, args: string[]): Promise<void> =>
    new Promise((resolve, reject) => {
      execFile(cmd, args, (error) => {
        if (error) reject(error)
        else resolve()
      })
    })

  ipcMain.handle('shell:open-in-editor', async (_event, options: {
    path: string
    editor: 'vscode' | 'cursor' | 'windsurf' | 'goland'
  }) => {
    try {
      const editorCommands: Record<string, string> = {
        vscode: 'code',
        cursor: 'cursor',
        windsurf: 'windsurf',
        goland: 'goland'
      }
      const cmd = editorCommands[options.editor] ?? 'code'
      await run(cmd, [options.path])
      return { ok: true }
    } catch (error) {
      logIpcError('shell:open-in-editor', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('shell:open-terminal', async (_event, options: { path: string; terminal?: string }) => {
    try {
      const terminal = options.terminal || 'default'

      if (process.platform === 'darwin') {
        const app = terminal === 'default' ? 'Terminal' : terminal
        await run('open', ['-a', app, options.path])
      } else {
        await run('xdg-open', [options.path])
      }

      return { ok: true }
    } catch (error) {
      logIpcError('shell:open-terminal', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('shell:open-external', async (_event, url: string) => {
    try {
      await shell.openExternal(url)
      return { ok: true }
    } catch (error) {
      logIpcError('shell:open-external', error)
      return { ok: false, error: String(error) }
    }
  })
}
