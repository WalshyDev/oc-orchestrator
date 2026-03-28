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
      return { ok: true, data: { id: handle.id, sessionId: handle.sessionId } }
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
        prompt: agent.prompt,
        title: agent.title
      }))
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
      runtimeManager.stopRuntime(runtimeId)
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
    editor: 'vscode' | 'cursor'
  }) => {
    try {
      const command = options.editor === 'vscode' ? 'code' : 'cursor'
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

  ipcMain.handle('shell:open-terminal', async (_event, options: { path: string }) => {
    try {
      await new Promise<void>((resolve, reject) => {
        exec(`open -a Terminal "${options.path}"`, (error) => {
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
