import type { ToolCall } from '../components/ToolsUsage'

// ── Status: server-derived, read-only ──

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

// ── Labels: user-applied workflow tags ──

export type AgentLabel = 'in_review' | 'blocked' | 'done' | 'draft'

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
  label: AgentLabel | null
  model: string
  prUrl: string | null
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

export function isUrgent(agent: { status: AgentStatus; label: AgentLabel | null }): boolean {
  return isBlocked(agent.status) || agent.status === 'errored' || agent.label === 'blocked'
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
    errored: 'Errored',
    disconnected: 'Disconnected',
    stopping: 'Stopping'
  }
  return labels[status]
}

export function agentLabelDisplay(label: AgentLabel | null): string {
  if (!label) return 'None'
  const labels: Record<AgentLabel, string> = {
    in_review: 'In Review',
    blocked: 'Blocked',
    done: 'Done',
    draft: 'Draft'
  }
  return labels[label]
}
