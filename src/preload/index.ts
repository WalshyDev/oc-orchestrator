import { contextBridge, ipcRenderer } from 'electron'

export interface IpcResult<T = unknown> {
  ok: boolean
  data?: T
  error?: string
}

const api = {
  // ── Agent Operations ──
  launchAgent: (options: { directory: string; prompt?: string; title?: string }): Promise<IpcResult> =>
    ipcRenderer.invoke('agent:launch', options),

  sendMessage: (agentId: string, text: string): Promise<IpcResult> =>
    ipcRenderer.invoke('agent:send-message', agentId, text),

  respondToPermission: (agentId: string, permissionId: string, response: 'once' | 'always' | 'reject'): Promise<IpcResult> =>
    ipcRenderer.invoke('agent:respond-permission', agentId, permissionId, response),

  abortAgent: (agentId: string): Promise<IpcResult> =>
    ipcRenderer.invoke('agent:abort', agentId),

  getMessages: (agentId: string): Promise<IpcResult> =>
    ipcRenderer.invoke('agent:get-messages', agentId),

  listAgents: (): Promise<IpcResult> =>
    ipcRenderer.invoke('agent:list'),

  getStatuses: (): Promise<IpcResult> =>
    ipcRenderer.invoke('agent:statuses'),

  // ── Runtime Operations ──
  listRuntimes: (): Promise<IpcResult> =>
    ipcRenderer.invoke('runtime:list'),

  stopRuntime: (runtimeId: string): Promise<IpcResult> =>
    ipcRenderer.invoke('runtime:stop', runtimeId),

  // ── Dialog ──
  selectDirectory: (): Promise<IpcResult<string>> =>
    ipcRenderer.invoke('dialog:select-directory'),

  // ── Workspace Operations ──
  validateGitRepo: (directory: string): Promise<IpcResult<boolean>> =>
    ipcRenderer.invoke('workspace:validate-git', directory),

  getWorktreeRoot: (): Promise<IpcResult<string>> =>
    ipcRenderer.invoke('workspace:root'),

  getRepoRoot: (directory: string): Promise<IpcResult<string>> =>
    ipcRenderer.invoke('workspace:repo-root', directory),

  createWorktree: (options: { repoRoot: string; projectSlug: string; taskSlug: string }): Promise<IpcResult<{ worktreePath: string; branchName: string }>> =>
    ipcRenderer.invoke('workspace:create', options),

  createFreshWorktree: (options: { repoRoot: string; projectSlug: string; taskSlug: string }): Promise<IpcResult<{ worktreePath: string; branchName: string; baseRef: string }>> =>
    ipcRenderer.invoke('workspace:create-fresh', options),

  removeWorktree: (options: { repoRoot: string; worktreePath: string }): Promise<IpcResult> =>
    ipcRenderer.invoke('workspace:remove', options),

  listWorktrees: (repoRoot: string): Promise<IpcResult> =>
    ipcRenderer.invoke('workspace:list', repoRoot),

  getWorktreeStatus: (worktreePath: string): Promise<IpcResult> =>
    ipcRenderer.invoke('workspace:status', worktreePath),

  // ── Database: Projects ──
  listProjects: (): Promise<IpcResult> =>
    ipcRenderer.invoke('db:projects:list'),

  createProject: (options: { name: string; repoRoot: string }): Promise<IpcResult> =>
    ipcRenderer.invoke('db:projects:create', options),

  deleteProject: (projectId: string): Promise<IpcResult> =>
    ipcRenderer.invoke('db:projects:delete', projectId),

  // ── Database: Preferences ──
  getPreference: (key: string): Promise<IpcResult<string | undefined>> =>
    ipcRenderer.invoke('db:preferences:get', key),

  setPreference: (key: string, value: string): Promise<IpcResult> =>
    ipcRenderer.invoke('db:preferences:set', key, value),

  // ── Notifications ──
  getNotificationPreferences: (): Promise<IpcResult> =>
    ipcRenderer.invoke('notifications:get-preferences'),

  setNotificationPreference: (eventType: string, enabled: boolean): Promise<IpcResult> =>
    ipcRenderer.invoke('notifications:set-preference', eventType, enabled),

  // ── Shell Integration ──
  openInEditor: (options: { path: string; editor: 'vscode' | 'cursor' }): Promise<IpcResult> =>
    ipcRenderer.invoke('shell:open-in-editor', options),

  openTerminal: (options: { path: string }): Promise<IpcResult> =>
    ipcRenderer.invoke('shell:open-terminal', options),

  openExternal: (url: string): Promise<IpcResult> =>
    ipcRenderer.invoke('shell:open-external', url),

  // ── Event Listeners ──
  onEvent: (callback: (data: { runtimeId: string; directory: string; event: { type: string; properties: unknown } }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data as never)
    ipcRenderer.on('opencode:event', handler)
    return () => ipcRenderer.removeListener('opencode:event', handler)
  },

  onAgentLaunched: (callback: (data: { id: string; runtimeId: string; sessionId: string; directory: string; branchName: string; prompt: string; title: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data as never)
    ipcRenderer.on('agent:launched', handler)
    return () => ipcRenderer.removeListener('agent:launched', handler)
  },

  onRuntimeStarted: (callback: (data: { id: string; directory: string; serverUrl: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data as never)
    ipcRenderer.on('runtime:started', handler)
    return () => ipcRenderer.removeListener('runtime:started', handler)
  },

  onRuntimeStopped: (callback: (data: { id: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data as never)
    ipcRenderer.on('runtime:stopped', handler)
    return () => ipcRenderer.removeListener('runtime:stopped', handler)
  },

  onEventError: (callback: (data: { runtimeId: string; error: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data as never)
    ipcRenderer.on('event:error', handler)
    return () => ipcRenderer.removeListener('event:error', handler)
  }
}

export type OrchestratorApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-expect-error global augmentation
  window.api = api
}
