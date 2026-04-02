export interface IpcResult<T = unknown> {
  ok: boolean
  data?: T
  error?: string
}

export interface MessageAttachment {
  id?: string
  mime: string
  dataUrl: string
  filename?: string
}

export interface OrchestratorApi {
  launchAgent: (options: { directory: string; prompt?: string; title?: string; model?: string; attachments?: MessageAttachment[] }) => Promise<IpcResult>
  sendMessage: (agentId: string, text: string, agent?: string, attachments?: MessageAttachment[]) => Promise<IpcResult>
  respondToPermission: (agentId: string, permissionId: string, response: 'once' | 'always' | 'reject') => Promise<IpcResult>
  abortAgent: (agentId: string) => Promise<IpcResult>
  removeAgent: (agentId: string) => Promise<IpcResult>
  resetSession: (agentId: string, prompt?: string) => Promise<IpcResult>
  getMessages: (agentId: string) => Promise<IpcResult>
  listCommands: (agentId: string) => Promise<IpcResult>
  executeCommand: (agentId: string, command: string, args: string) => Promise<IpcResult>
  getConfig: (agentId: string) => Promise<IpcResult>
  updateConfig: (agentId: string, config: Record<string, unknown>) => Promise<IpcResult>
  getProviders: (agentId: string) => Promise<IpcResult>
  getMcpStatus: (agentId: string) => Promise<IpcResult>
  connectMcp: (agentId: string, name: string) => Promise<IpcResult>
  disconnectMcp: (agentId: string, name: string) => Promise<IpcResult>
  compactSession: (agentId: string) => Promise<IpcResult>
  shareSession: (agentId: string) => Promise<IpcResult>
  listAgentConfigs: (agentId: string) => Promise<IpcResult>
  listTools: (agentId: string) => Promise<IpcResult>
  sendMessageWithModel: (agentId: string, text: string, providerID: string, modelID: string, attachments?: MessageAttachment[]) => Promise<IpcResult>
  listSessions: (directory: string) => Promise<IpcResult<SessionListEntry[]>>
  resumeAgent: (options: { directory: string; sessionId: string; title?: string }) => Promise<IpcResult>
  listAgents: () => Promise<IpcResult<ListAgentsPayload>>
  updateAgentMeta: (agentId: string, meta: { displayName?: string; taskSummary?: string; persistedStatus?: string; prUrl?: string }) => Promise<IpcResult>
  getStatuses: () => Promise<IpcResult<AgentStatusesPayload>>
  replyToQuestion: (agentId: string, requestId: string, answers: string[][]) => Promise<IpcResult>
  rejectQuestion: (agentId: string, requestId: string) => Promise<IpcResult>
  listQuestions: () => Promise<IpcResult<PendingQuestionsPayload>>
  listRuntimes: () => Promise<IpcResult>
  stopRuntime: (runtimeId: string) => Promise<IpcResult>
  listAllProviders: () => Promise<IpcResult>
  getSystemConfig: () => Promise<IpcResult>
  listAllCommands: () => Promise<IpcResult>
  listAllAgentConfigs: () => Promise<IpcResult>
  selectDirectory: () => Promise<IpcResult<string>>

  // ── Workspace Operations ──
  validateGitRepo: (directory: string) => Promise<IpcResult<boolean>>
  getWorktreeRoot: () => Promise<IpcResult<string>>
  getRepoRoot: (directory: string) => Promise<IpcResult<string>>
  getCommonRepoRoot: (directory: string) => Promise<IpcResult<string>>
  createWorktree: (options: { repoRoot: string; projectSlug: string; taskSlug: string }) => Promise<IpcResult<{ worktreePath: string; branchName: string }>>
  createFreshWorktree: (options: { repoRoot: string; projectSlug: string; taskSlug: string }) => Promise<IpcResult<{ worktreePath: string; branchName: string; baseRef: string }>>
  removeWorktree: (options: { repoRoot: string; worktreePath: string }) => Promise<IpcResult>
  listWorktrees: (repoRoot: string) => Promise<IpcResult<WorktreeListEntry[]>>
  getWorktreeStatus: (worktreePath: string) => Promise<IpcResult<WorktreeStatus>>

  // ── Database: Projects ──
  listProjects: () => Promise<IpcResult<Project[]>>
  createProject: (options: { name: string; repoRoot: string }) => Promise<IpcResult<Project>>
  ensureProject: (options: { name: string; repoRoot: string }) => Promise<IpcResult<Project>>
  deleteProject: (projectId: string) => Promise<IpcResult<boolean>>

  // ── Database: Preferences ──
  getPreference: (key: string) => Promise<IpcResult<string | undefined>>
  setPreference: (key: string, value: string) => Promise<IpcResult>

  // ── Notifications ──
  getNotificationPreferences: () => Promise<IpcResult<NotificationPreferences>>
  setNotificationPreference: (eventType: NotifiableEventType, enabled: boolean) => Promise<IpcResult>
  getPendingNotificationAgent: () => Promise<IpcResult<string | null>>

  // ── App Info ──
  getVersion: () => Promise<IpcResult<string>>

  // ── Shell Integration ──
  notifyAgentStatus: (agentId: string, status: string, agentName: string, projectName?: string, preview?: string) => Promise<IpcResult>
  openInEditor: (options: { path: string; editor: 'vscode' | 'cursor' | 'windsurf' | 'goland' }) => Promise<IpcResult>
  openTerminal: (options: { path: string; terminal?: string }) => Promise<IpcResult>
  openExternal: (url: string) => Promise<IpcResult>

  onEvent: (callback: (data: OpenCodeEventPayload) => void) => () => void
  onAgentLaunched: (callback: (data: AgentLaunchedPayload) => void) => () => void
  onSessionReset: (callback: (data: SessionResetPayload) => void) => () => void
  onRuntimeStarted: (callback: (data: RuntimeStartedPayload) => void) => () => void
  onRuntimeStopped: (callback: (data: { id: string }) => void) => () => void
  onEventError: (callback: (data: { runtimeId: string; error: string }) => void) => () => void
  onUpdateAvailable: (callback: (data: { currentVersion: string; latestVersion: string }) => void) => () => void
  onNotificationSelectAgent: (callback: (data: { agentId: string }) => void) => () => void
}

export interface WorktreeListEntry {
  path: string
  head: string
  branch: string
}

export interface SessionListEntry {
  id: string
  title: string
  createdAt: number
  updatedAt: number
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
  displayName?: string
  taskSummary?: string
  persistedStatus?: string
  prUrl?: string
}

export interface SessionResetPayload {
  id: string
  sessionId: string
  oldSessionId: string
  branchName: string
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

export interface QuestionOption {
  label: string
  description: string
}

export interface QuestionInfo {
  question: string
  header: string
  options: QuestionOption[]
  multiple?: boolean
  custom?: boolean
}

export interface QuestionRequest {
  id: string
  sessionID: string
  questions: QuestionInfo[]
  tool?: {
    messageID: string
    callID: string
  }
}

export type PendingQuestionsPayload = Array<{
  agentId: string
  questions: QuestionRequest[]
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
