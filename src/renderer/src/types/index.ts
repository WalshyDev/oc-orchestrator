export type AgentStatus =
  | 'starting'
  | 'running'
  | 'needs_input'
  | 'needs_approval'
  | 'idle'
  | 'completed'
  | 'errored'
  | 'disconnected'
  | 'stopping'

export type InterruptKind =
  | 'needs_input'
  | 'needs_approval'
  | 'auth_required'
  | 'process_error'
  | 'disconnected'
  | 'completed'

export interface Project {
  id: string
  name: string
  repoRoot: string
  color: string
}

export interface AgentRuntime {
  id: string
  name: string
  projectId: string
  projectName: string
  branchName: string
  taskSummary: string
  status: AgentStatus
  model: string
  lastActivityAt: string
  blockedSince?: string
}

export interface Interrupt {
  id: string
  runtimeId: string
  agentName: string
  projectName: string
  kind: InterruptKind
  reason: string
  createdAt: string
  resolvedAt?: string
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  timestamp: string
  toolName?: string
  toolState?: 'running' | 'completed' | 'failed'
}

export function isBlocked(status: AgentStatus): boolean {
  return status === 'needs_input' || status === 'needs_approval'
}

export function isUrgent(agent: AgentRuntime): boolean {
  return isBlocked(agent.status) || agent.status === 'errored'
}

export function statusLabel(status: AgentStatus): string {
  const labels: Record<AgentStatus, string> = {
    starting: 'Starting',
    running: 'Running',
    needs_input: 'Needs Input',
    needs_approval: 'Needs Approval',
    idle: 'Idle',
    completed: 'Completed',
    errored: 'Errored',
    disconnected: 'Disconnected',
    stopping: 'Stopping'
  }
  return labels[status]
}
