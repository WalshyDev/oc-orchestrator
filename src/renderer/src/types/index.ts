import type { ToolCall } from '../components/ToolsUsage'

export type AgentStatus =
  | 'starting'
  | 'running'
  | 'needs_input'
  | 'needs_approval'
  | 'idle'
  | 'completed'
  | 'completed_manual'
  | 'in_review'
  | 'blocked_manual'
  | 'errored'
  | 'disconnected'
  | 'stopping'

export type StatusOverride = 'completed_manual' | 'in_review' | 'blocked_manual'

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
  isWorktree: boolean
  workspaceName: string
  taskSummary: string
  status: AgentStatus
  statusOverride: StatusOverride | null
  model: string
  lastActivityAt: string
  lastActivityAtMs: number
  blockedSince?: string
  blockedSinceMs?: number
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

export interface MessageImage {
  mime: string
  url: string
  filename?: string
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'tool-group'
  content: string
  timestamp: string
  toolName?: string
  toolState?: 'running' | 'completed' | 'failed'
  toolCalls?: ToolCall[]
  images?: MessageImage[]
}

export function isBlocked(status: AgentStatus): boolean {
  return status === 'needs_input' || status === 'needs_approval'
}

export function isUrgent(agent: AgentRuntime): boolean {
  return isBlocked(agent.status) || agent.status === 'errored' || agent.status === 'blocked_manual'
}

export function displayStatus(agent: { status: AgentStatus; statusOverride?: StatusOverride | null }): AgentStatus {
  return agent.statusOverride ?? agent.status
}

export function formatBranchLabel(agent: Pick<AgentRuntime, 'branchName'>): string {
  return agent.branchName ?? ''
}

export function statusLabel(status: AgentStatus): string {
  const labels: Record<AgentStatus, string> = {
    starting: 'Starting',
    running: 'Running',
    needs_input: 'Needs Input',
    needs_approval: 'Needs Approval',
    idle: 'Idle',
    completed: 'Completed',
    completed_manual: 'Completed',
    in_review: 'In Review',
    blocked_manual: 'Blocked',
    errored: 'Errored',
    disconnected: 'Disconnected',
    stopping: 'Stopping'
  }
  return labels[status]
}

export function statusOverrideLabel(override: StatusOverride | null): string {
  if (!override) return 'Auto'
  const labels: Record<StatusOverride, string> = {
    completed_manual: 'Completed',
    in_review: 'In Review',
    blocked_manual: 'Blocked'
  }
  return labels[override]
}
