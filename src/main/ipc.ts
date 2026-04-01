import { ipcMain, dialog, shell } from 'electron'
import { exec } from 'child_process'
import { agentController } from './services/agent-controller'
import { runtimeManager } from './services/runtime-manager'
import { workspaceManager } from './services/workspace-manager'
import { database } from './services/database'
import { notificationService, type NotifiableEventType } from './services/notification-service'

/**
 * Register all IPC handlers for renderer <-> main communication.
 */
export function registerIpcHandlers(): void {
  // ── Agent Lifecycle ──

  ipcMain.handle('agent:launch', async (_event, options: {
    directory: string
    prompt?: string
    title?: string
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
      console.error('[IPC] agent:launch failed:', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:send-message', async (_event, agentId: string, text: string) => {
    try {
      await agentController.sendMessage(agentId, text)
      return { ok: true }
    } catch (error) {
      console.error('[IPC] agent:send-message failed:', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:respond-permission', async (_event, agentId: string, permissionId: string, response: 'once' | 'always' | 'reject') => {
    try {
      await agentController.respondToPermission(agentId, permissionId, response)
      return { ok: true }
    } catch (error) {
      console.error('[IPC] agent:respond-permission failed:', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:abort', async (_event, agentId: string) => {
    try {
      await agentController.abortAgent(agentId)
      return { ok: true }
    } catch (error) {
      console.error('[IPC] agent:abort failed:', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:remove', async (_event, agentId: string) => {
    try {
      await agentController.removeAgent(agentId)
      return { ok: true }
    } catch (error) {
      console.error('[IPC] agent:remove failed:', error)
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
      console.error('[IPC] agent:reset-session failed:', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:list-commands', async (_event, agentId: string) => {
    try {
      const commands = await agentController.listCommands(agentId)
      return { ok: true, data: commands }
    } catch (error) {
      console.error('[IPC] agent:list-commands failed:', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:execute-command', async (_event, agentId: string, command: string, args: string) => {
    try {
      const result = await agentController.executeCommand(agentId, command, args)
      return { ok: true, data: result }
    } catch (error) {
      console.error('[IPC] agent:execute-command failed:', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:get-config', async (_event, agentId: string) => {
    try {
      const config = await agentController.getConfig(agentId)
      return { ok: true, data: config }
    } catch (error) {
      console.error('[IPC] agent:get-config failed:', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:update-config', async (_event, agentId: string, config: Record<string, unknown>) => {
    try {
      const result = await agentController.updateConfig(agentId, config)
      return { ok: true, data: result }
    } catch (error) {
      console.error('[IPC] agent:update-config failed:', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:get-providers', async (_event, agentId: string) => {
    try {
      const providers = await agentController.getProviders(agentId)
      return { ok: true, data: providers }
    } catch (error) {
      console.error('[IPC] agent:get-providers failed:', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:mcp-status', async (_event, agentId: string) => {
    try {
      const status = await agentController.getMcpStatus(agentId)
      return { ok: true, data: status }
    } catch (error) {
      console.error('[IPC] agent:mcp-status failed:', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:mcp-connect', async (_event, agentId: string, name: string) => {
    try {
      const result = await agentController.connectMcp(agentId, name)
      return { ok: true, data: result }
    } catch (error) {
      console.error('[IPC] agent:mcp-connect failed:', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:mcp-disconnect', async (_event, agentId: string, name: string) => {
    try {
      const result = await agentController.disconnectMcp(agentId, name)
      return { ok: true, data: result }
    } catch (error) {
      console.error('[IPC] agent:mcp-disconnect failed:', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:compact', async (_event, agentId: string) => {
    try {
      const result = await agentController.compactSession(agentId)
      return { ok: true, data: result }
    } catch (error) {
      console.error('[IPC] agent:compact failed:', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:share', async (_event, agentId: string) => {
    try {
      const result = await agentController.shareSession(agentId)
      return { ok: true, data: result }
    } catch (error) {
      console.error('[IPC] agent:share failed:', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:list-agent-configs', async (_event, agentId: string) => {
    try {
      const agents = await agentController.listAgentConfigs(agentId)
      return { ok: true, data: agents }
    } catch (error) {
      console.error('[IPC] agent:list-agent-configs failed:', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:list-tools', async (_event, agentId: string) => {
    try {
      const tools = await agentController.listTools(agentId)
      return { ok: true, data: tools }
    } catch (error) {
      console.error('[IPC] agent:list-tools failed:', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:send-message-with-model', async (_event, agentId: string, text: string, providerID: string, modelID: string) => {
    try {
      await agentController.sendMessageWithModel(agentId, text, providerID, modelID)
      return { ok: true }
    } catch (error) {
      console.error('[IPC] agent:send-message-with-model failed:', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:get-messages', async (_event, agentId: string) => {
    try {
      const messages = await agentController.getMessages(agentId)
      return { ok: true, data: messages }
    } catch (error) {
      console.error('[IPC] agent:get-messages failed:', error)
      return { ok: false, error: String(error) }
    }
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
        taskSummary: agent.taskSummary
      }))
    }
  })

  ipcMain.handle('agent:update-meta', async (_event, agentId: string, meta: { displayName?: string; taskSummary?: string }) => {
    try {
      agentController.updateAgentMeta(agentId, meta)
      return { ok: true }
    } catch (error) {
      console.error('[IPC] agent:update-meta failed:', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('agent:statuses', async () => {
    try {
      const statuses = await agentController.getSessionStatuses()
      return { ok: true, data: statuses }
    } catch (error) {
      console.error('[IPC] agent:statuses failed:', error)
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
      console.error('[IPC] workspace:validate-git failed:', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('workspace:root', async () => {
    try {
      const root = workspaceManager.getWorktreeRoot()
      return { ok: true, data: root }
    } catch (error) {
      console.error('[IPC] workspace:root failed:', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('workspace:repo-root', async (_event, directory: string) => {
    try {
      const repoRoot = workspaceManager.getRepoRoot(directory)
      return { ok: true, data: repoRoot }
    } catch (error) {
      console.error('[IPC] workspace:repo-root failed:', error)
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
      console.error('[IPC] workspace:create failed:', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('workspace:create-fresh', async (_event, options: {
    repoRoot: string
    projectSlug: string
    taskSlug: string
  }) => {
    try {
      const result = workspaceManager.createFreshWorktree(options.repoRoot, options.projectSlug, options.taskSlug)
      return { ok: true, data: result }
    } catch (error) {
      console.error('[IPC] workspace:create-fresh failed:', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('workspace:remove', async (_event, options: {
    repoRoot: string
    worktreePath: string
  }) => {
    try {
      workspaceManager.removeWorktree(options.repoRoot, options.worktreePath)
      return { ok: true }
    } catch (error) {
      console.error('[IPC] workspace:remove failed:', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('workspace:list', async (_event, repoRoot: string) => {
    try {
      const worktrees = workspaceManager.listWorktrees(repoRoot)
      return { ok: true, data: worktrees }
    } catch (error) {
      console.error('[IPC] workspace:list failed:', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('workspace:status', async (_event, worktreePath: string) => {
    try {
      const status = workspaceManager.getWorktreeStatus(worktreePath)
      return { ok: true, data: status }
    } catch (error) {
      console.error('[IPC] workspace:status failed:', error)
      return { ok: false, error: String(error) }
    }
  })

  // ── Database: Projects ──

  ipcMain.handle('db:projects:list', async () => {
    try {
      const projects = database.getAllProjects()
      return { ok: true, data: projects }
    } catch (error) {
      console.error('[IPC] db:projects:list failed:', error)
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
      console.error('[IPC] db:projects:create failed:', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('db:projects:delete', async (_event, projectId: string) => {
    try {
      const deleted = database.deleteProject(projectId)
      return { ok: true, data: deleted }
    } catch (error) {
      console.error('[IPC] db:projects:delete failed:', error)
      return { ok: false, error: String(error) }
    }
  })

  // ── Database: Preferences ──

  ipcMain.handle('db:preferences:get', async (_event, key: string) => {
    try {
      const value = database.getPreference(key)
      return { ok: true, data: value }
    } catch (error) {
      console.error('[IPC] db:preferences:get failed:', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('db:preferences:set', async (_event, key: string, value: string) => {
    try {
      database.setPreference(key, value)
      return { ok: true }
    } catch (error) {
      console.error('[IPC] db:preferences:set failed:', error)
      return { ok: false, error: String(error) }
    }
  })

  // ── Notifications ──

  ipcMain.handle('notifications:get-preferences', async () => {
    try {
      const preferences = notificationService.getPreferences()
      return { ok: true, data: preferences }
    } catch (error) {
      console.error('[IPC] notifications:get-preferences failed:', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('notifications:set-preference', async (_event, eventType: NotifiableEventType, enabled: boolean) => {
    try {
      notificationService.setPreference(eventType, enabled)
      return { ok: true }
    } catch (error) {
      console.error('[IPC] notifications:set-preference failed:', error)
      return { ok: false, error: String(error) }
    }
  })

  // ── Shell Integration ──

  ipcMain.handle('shell:open-in-editor', async (_event, options: {
    path: string
    editor: 'vscode' | 'cursor' | 'windsurf'
  }) => {
    try {
      const editorCommands: Record<string, string> = {
        vscode: 'code',
        cursor: 'cursor',
        windsurf: 'windsurf'
      }
      const command = editorCommands[options.editor] ?? 'code'
      await new Promise<void>((resolve, reject) => {
        exec(`${command} "${options.path}"`, (error) => {
          if (error) reject(error)
          else resolve()
        })
      })
      return { ok: true }
    } catch (error) {
      console.error('[IPC] shell:open-in-editor failed:', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('shell:open-terminal', async (_event, options: { path: string; terminal?: string }) => {
    try {
      const terminal = options.terminal || 'default'
      let command: string

      if (process.platform === 'darwin') {
        if (terminal === 'default') {
          // Use macOS `open` which respects the default terminal
          command = `open -a Terminal "${options.path}"`
        } else {
          command = `open -a "${terminal}" "${options.path}"`
        }
      } else {
        command = `xdg-open "${options.path}"`
      }

      await new Promise<void>((resolve, reject) => {
        exec(command, (error) => {
          if (error) reject(error)
          else resolve()
        })
      })
      return { ok: true }
    } catch (error) {
      console.error('[IPC] shell:open-terminal failed:', error)
      return { ok: false, error: String(error) }
    }
  })

  ipcMain.handle('shell:open-external', async (_event, url: string) => {
    try {
      await shell.openExternal(url)
      return { ok: true }
    } catch (error) {
      console.error('[IPC] shell:open-external failed:', error)
      return { ok: false, error: String(error) }
    }
  })
}
