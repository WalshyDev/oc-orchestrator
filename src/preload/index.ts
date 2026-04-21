import { contextBridge, ipcRenderer } from 'electron'

export interface IpcResult<T = unknown> {
  ok: boolean
  data?: T
  error?: string
}

interface Attachment {
  id?: string
  mime: string
  dataUrl: string
  filename?: string
}

const api = {
  // ── Agent Operations ──
  launchAgent: (options: { directory: string; prompt?: string; title?: string; model?: string; attachments?: Attachment[] }): Promise<IpcResult> =>
    ipcRenderer.invoke('agent:launch', options),

  sendMessage: (agentId: string, text: string, agent?: string, attachments?: Attachment[]): Promise<IpcResult> =>
    ipcRenderer.invoke('agent:send-message', agentId, text, agent, attachments),

  respondToPermission: (agentId: string, permissionId: string, response: 'once' | 'always' | 'reject'): Promise<IpcResult> =>
    ipcRenderer.invoke('agent:respond-permission', agentId, permissionId, response),

  abortAgent: (agentId: string): Promise<IpcResult> =>
    ipcRenderer.invoke('agent:abort', agentId),

  removeAgent: (agentId: string): Promise<IpcResult> =>
    ipcRenderer.invoke('agent:remove', agentId),

  resetSession: (agentId: string, prompt?: string): Promise<IpcResult> =>
    ipcRenderer.invoke('agent:reset-session', agentId, prompt),

  getMessages: (agentId: string): Promise<IpcResult> =>
    ipcRenderer.invoke('agent:get-messages', agentId),

  listCommands: (agentId: string): Promise<IpcResult> =>
    ipcRenderer.invoke('agent:list-commands', agentId),

  executeCommand: (agentId: string, command: string, args: string): Promise<IpcResult> =>
    ipcRenderer.invoke('agent:execute-command', agentId, command, args),

  getConfig: (agentId: string): Promise<IpcResult> =>
    ipcRenderer.invoke('agent:get-config', agentId),

  updateConfig: (agentId: string, config: Record<string, unknown>): Promise<IpcResult> =>
    ipcRenderer.invoke('agent:update-config', agentId, config),

  getProviders: (agentId: string): Promise<IpcResult> =>
    ipcRenderer.invoke('agent:get-providers', agentId),

  getMcpStatus: (agentId: string): Promise<IpcResult> =>
    ipcRenderer.invoke('agent:mcp-status', agentId),

  connectMcp: (agentId: string, name: string): Promise<IpcResult> =>
    ipcRenderer.invoke('agent:mcp-connect', agentId, name),

  disconnectMcp: (agentId: string, name: string): Promise<IpcResult> =>
    ipcRenderer.invoke('agent:mcp-disconnect', agentId, name),

  compactSession: (agentId: string): Promise<IpcResult> =>
    ipcRenderer.invoke('agent:compact', agentId),

  shareSession: (agentId: string): Promise<IpcResult> =>
    ipcRenderer.invoke('agent:share', agentId),

  listAgentConfigs: (agentId: string): Promise<IpcResult> =>
    ipcRenderer.invoke('agent:list-agent-configs', agentId),

  listTools: (agentId: string): Promise<IpcResult> =>
    ipcRenderer.invoke('agent:list-tools', agentId),

  sendMessageWithModel: (agentId: string, text: string, providerID: string, modelID: string, attachments?: Attachment[]): Promise<IpcResult> =>
    ipcRenderer.invoke('agent:send-message-with-model', agentId, text, providerID, modelID, attachments),

  listSessions: (directory: string): Promise<IpcResult<Array<{ id: string; title: string; createdAt: number; updatedAt: number }>>> =>
    ipcRenderer.invoke('session:list', directory),

  listSessionsByProject: (projectDirectory: string): Promise<IpcResult<Array<{ id: string; title: string; directory: string; createdAt: number; updatedAt: number }>>> =>
    ipcRenderer.invoke('session:list-by-project', projectDirectory),

  forkSession: (options: { sourceSessionId: string; targetDirectory: string }): Promise<IpcResult<{ sessionId: string; title: string }>> =>
    ipcRenderer.invoke('session:fork', options),

  resumeAgent: (options: { directory: string; sessionId: string; title?: string }): Promise<IpcResult> =>
    ipcRenderer.invoke('agent:resume', options),

  listAgents: (): Promise<IpcResult> =>
    ipcRenderer.invoke('agent:list'),

  isAgentsRestored: (): Promise<IpcResult<boolean>> =>
    ipcRenderer.invoke('agent:restored'),

  updateAgentMeta: (agentId: string, meta: { displayName?: string; taskSummary?: string; persistedStatus?: string; labelIds?: string[] }): Promise<IpcResult> =>
    ipcRenderer.invoke('agent:update-meta', agentId, meta),

  getStatuses: (): Promise<IpcResult> =>
    ipcRenderer.invoke('agent:statuses'),

  replyToQuestion: (agentId: string, requestId: string, answers: string[][]): Promise<IpcResult> =>
    ipcRenderer.invoke('agent:reply-question', agentId, requestId, answers),

  rejectQuestion: (agentId: string, requestId: string): Promise<IpcResult> =>
    ipcRenderer.invoke('agent:reject-question', agentId, requestId),

  listQuestions: (): Promise<IpcResult> =>
    ipcRenderer.invoke('agent:list-questions'),

  listPermissions: (): Promise<IpcResult> =>
    ipcRenderer.invoke('agent:list-permissions'),

  // ── Runtime Operations ──
  listRuntimes: (): Promise<IpcResult> =>
    ipcRenderer.invoke('runtime:list'),

  stopRuntime: (runtimeId: string): Promise<IpcResult> =>
    ipcRenderer.invoke('runtime:stop', runtimeId),

  listAllProviders: (): Promise<IpcResult> =>
    ipcRenderer.invoke('runtime:providers'),

  getSystemConfig: (): Promise<IpcResult> =>
    ipcRenderer.invoke('runtime:config'),

  listAllCommands: (): Promise<IpcResult> =>
    ipcRenderer.invoke('runtime:commands'),

  listAllAgentConfigs: (): Promise<IpcResult> =>
    ipcRenderer.invoke('runtime:agent-configs'),

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

  getCommonRepoRoot: (directory: string): Promise<IpcResult<string>> =>
    ipcRenderer.invoke('workspace:common-repo-root', directory),

  createWorktree: (options: { repoRoot: string; projectSlug: string; taskSlug: string }): Promise<IpcResult<{ worktreePath: string; branchName: string }>> =>
    ipcRenderer.invoke('workspace:create', options),

  createFreshWorktree: (options: { repoRoot: string; projectSlug: string; taskSlug: string; baseRef?: string }): Promise<IpcResult<{ worktreePath: string; branchName: string; baseRef: string }>> =>
    ipcRenderer.invoke('workspace:create-fresh', options),

  getDefaultBranch: (repoRoot: string): Promise<IpcResult<string>> =>
    ipcRenderer.invoke('workspace:default-branch', repoRoot),

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

  ensureProject: (options: { name: string; repoRoot: string }): Promise<IpcResult> =>
    ipcRenderer.invoke('db:projects:ensure', options),

  deleteProject: (projectId: string): Promise<IpcResult> =>
    ipcRenderer.invoke('db:projects:delete', projectId),

  updateProjectSettings: (options: { repoRoot: string; settings: { default_branch?: string | null; fresh_worktree?: boolean } }): Promise<IpcResult> =>
    ipcRenderer.invoke('db:projects:update-settings', options),

  // ── Database: Preferences ──
  getPreference: (key: string): Promise<IpcResult<string | undefined>> =>
    ipcRenderer.invoke('db:preferences:get', key),

  setPreference: (key: string, value: string): Promise<IpcResult> =>
    ipcRenderer.invoke('db:preferences:set', key, value),

  // ── Database: Custom Labels ──
  listCustomLabels: (): Promise<IpcResult> =>
    ipcRenderer.invoke('db:labels:list'),

  createCustomLabel: (options: { id: string; name: string; colorKey: string }): Promise<IpcResult> =>
    ipcRenderer.invoke('db:labels:create', options),

  updateCustomLabel: (options: { id: string; name: string; colorKey: string }): Promise<IpcResult> =>
    ipcRenderer.invoke('db:labels:update', options),

  deleteCustomLabel: (labelId: string): Promise<IpcResult> =>
    ipcRenderer.invoke('db:labels:delete', labelId),

  // ── Notifications ──
  getNotificationPreferences: (): Promise<IpcResult> =>
    ipcRenderer.invoke('notifications:get-preferences'),

  setNotificationPreference: (eventType: string, enabled: boolean): Promise<IpcResult> =>
    ipcRenderer.invoke('notifications:set-preference', eventType, enabled),

  getSoundEnabled: (): Promise<IpcResult<boolean>> =>
    ipcRenderer.invoke('notifications:get-sound-enabled'),

  setSoundEnabled: (enabled: boolean): Promise<IpcResult> =>
    ipcRenderer.invoke('notifications:set-sound-enabled', enabled),

  getPendingNotificationAgent: (): Promise<IpcResult<string | null>> =>
    ipcRenderer.invoke('notifications:get-pending-agent'),

  // ── App Info ──
  getVersion: (): Promise<IpcResult<string>> =>
    ipcRenderer.invoke('app:version'),

  getHomeDirectory: (): Promise<IpcResult<string>> =>
    ipcRenderer.invoke('app:home-directory'),

  // ── Shell Integration ──
  notifyAgentStatus: (agentId: string, status: string, agentName: string, projectName?: string, preview?: string): Promise<IpcResult> =>
    ipcRenderer.invoke('agent:notify-status', agentId, status, agentName, projectName, preview),

  openInEditor: (options: { path: string; editor: 'vscode' | 'cursor' | 'windsurf' | 'goland' }): Promise<IpcResult> =>
    ipcRenderer.invoke('shell:open-in-editor', options),

  openTerminal: (options: { path: string; terminal?: string }): Promise<IpcResult> =>
    ipcRenderer.invoke('shell:open-terminal', options),

  openExternal: (url: string): Promise<IpcResult> =>
    ipcRenderer.invoke('shell:open-external', url),

  // ── Event Listeners ──
  onEvent: (callback: (data: { runtimeId: string; directory: string; event: { type: string; properties: unknown } }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data as never)
    ipcRenderer.on('opencode:event', handler)
    return () => ipcRenderer.removeListener('opencode:event', handler)
  },

  onAgentLaunched: (callback: (data: { id: string; runtimeId: string; sessionId: string; directory: string; projectName: string; branchName: string; isWorktree: boolean; workspaceName: string; prompt: string; title: string }) => void) => {
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

  onSessionReset: (callback: (data: { id: string; sessionId: string; oldSessionId: string; branchName: string; prompt: string; title: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data as never)
    ipcRenderer.on('agent:session-reset', handler)
    return () => ipcRenderer.removeListener('agent:session-reset', handler)
  },

  onEventError: (callback: (data: { runtimeId: string; error: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data as never)
    ipcRenderer.on('event:error', handler)
    return () => ipcRenderer.removeListener('event:error', handler)
  },

  onUpdateAvailable: (callback: (data: { currentVersion: string; latestVersion: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data as never)
    ipcRenderer.on('update:available', handler)
    return () => ipcRenderer.removeListener('update:available', handler)
  },

  onNotificationSelectAgent: (callback: (data: { agentId: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data as never)
    ipcRenderer.on('notification:select-agent', handler)
    return () => ipcRenderer.removeListener('notification:select-agent', handler)
  },

  onAgentsRestored: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('agents:restored', handler)
    return () => ipcRenderer.removeListener('agents:restored', handler)
  },

  onMenuOpenSettings: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('menu:open-settings', handler)
    return () => ipcRenderer.removeListener('menu:open-settings', handler)
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
