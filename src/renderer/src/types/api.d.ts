export interface IpcResult<T = unknown> {
  ok: boolean
  data?: T
  error?: string
}

export interface OrchestratorApi {
  launchAgent: (options: { directory: string; prompt?: string; title?: string }) => Promise<IpcResult>
  sendMessage: (agentId: string, text: string) => Promise<IpcResult>
  respondToPermission: (agentId: string, permissionId: string, response: 'once' | 'always' | 'reject') => Promise<IpcResult>
  abortAgent: (agentId: string) => Promise<IpcResult>
  removeAgent: (agentId: string) => Promise<IpcResult>
  getMessages: (agentId: string) => Promise<IpcResult>
  listAgents: () => Promise<IpcResult<ListAgentsPayload>>
  getStatuses: () => Promise<IpcResult<AgentStatusesPayload>>
  listRuntimes: () => Promise<IpcResult>
  stopRuntime: (runtimeId: string) => Promise<IpcResult>
  selectDirectory: () => Promise<IpcResult<string>>

  // ── Workspace Operations ──
  validateGitRepo: (directory: string) => Promise<IpcResult<boolean>>
  getWorktreeRoot: () => Promise<IpcResult<string>>
  getRepoRoot: (directory: string) => Promise<IpcResult<string>>
  createWorktree: (options: { repoRoot: string; projectSlug: string; taskSlug: string }) => Promise<IpcResult<{ worktreePath: string; branchName: string }>>
  createFreshWorktree: (options: { repoRoot: string; projectSlug: string; taskSlug: string }) => Promise<IpcResult<{ worktreePath: string; branchName: string; baseRef: string }>>
  removeWorktree: (options: { repoRoot: string; worktreePath: string }) => Promise<IpcResult>
  listWorktrees: (repoRoot: string) => Promise<IpcResult<WorktreeListEntry[]>>
  getWorktreeStatus: (worktreePath: string) => Promise<IpcResult<WorktreeStatus>>

  // ── Database: Projects ──
  listProjects: () => Promise<IpcResult<Project[]>>
  createProject: (options: { name: string; repoRoot: string }) => Promise<IpcResult<Project>>
  deleteProject: (projectId: string) => Promise<IpcResult<boolean>>

  // ── Database: Preferences ──
  getPreference: (key: string) => Promise<IpcResult<string | undefined>>
  setPreference: (key: string, value: string) => Promise<IpcResult>

  // ── Notifications ──
  getNotificationPreferences: () => Promise<IpcResult<NotificationPreferences>>
  setNotificationPreference: (eventType: NotifiableEventType, enabled: boolean) => Promise<IpcResult>

  // ── Shell Integration ──
  openInEditor: (options: { path: string; editor: 'vscode' | 'cursor' }) => Promise<IpcResult>
  openTerminal: (options: { path: string }) => Promise<IpcResult>
  openExternal: (url: string) => Promise<IpcResult>

  onEvent: (callback: (data: OpenCodeEventPayload) => void) => () => void
  onAgentLaunched: (callback: (data: AgentLaunchedPayload) => void) => () => void
  onRuntimeStarted: (callback: (data: RuntimeStartedPayload) => void) => () => void
  onRuntimeStopped: (callback: (data: { id: string }) => void) => () => void
  onEventError: (callback: (data: { runtimeId: string; error: string }) => void) => () => void
}

export interface WorktreeListEntry {
  path: string
  head: string
  branch: string
}

export interface WorktreeStatus {
  dirty: boolean
  changedFiles: number
}

export interface Project {
  id: string
  name: string
  repo_root: string
  created_at: string
  updated_at: string
}

export type NotifiableEventType =
  | 'needs_approval'
  | 'needs_input'
  | 'errored'
  | 'completed'
  | 'disconnected'

export interface NotificationPreferences {
  needs_approval: boolean
  needs_input: boolean
  errored: boolean
  completed: boolean
  disconnected: boolean
}

export interface OpenCodeEventPayload {
  runtimeId: string
  directory: string
  event: {
    type: string
    properties: Record<string, unknown>
  }
}

export interface AgentLaunchedPayload {
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
}

export type ListAgentsPayload = AgentLaunchedPayload[]

export type AgentStatusesPayload = Record<string, {
  agentId: string
  status: {
    type: string
  }
}>

export interface RuntimeStartedPayload {
  id: string
  directory: string
  serverUrl: string
}

declare global {
  interface Window {
    api: OrchestratorApi
  }
}
