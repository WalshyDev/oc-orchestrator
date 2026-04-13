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

export type LabelColorKey =
  | 'red' | 'orange' | 'amber' | 'green' | 'teal'
  | 'blue' | 'indigo' | 'purple' | 'pink' | 'gray'

export interface LabelDefinition {
  id: string
  name: string
  colorKey: LabelColorKey
  builtIn: boolean
}

export interface LabelColorClasses { bg: string; text: string; border: string; swatch: string }

// Tailwind requires complete class literals — these cannot be generated dynamically.
export const LABEL_COLORS: Record<LabelColorKey, LabelColorClasses> = {
  red:    { bg: 'bg-red-500/12',    text: 'text-red-400',    border: 'border-red-500/30',    swatch: 'bg-red-500' },
  orange: { bg: 'bg-orange-500/12', text: 'text-orange-400', border: 'border-orange-500/30', swatch: 'bg-orange-500' },
  amber:  { bg: 'bg-amber-500/12',  text: 'text-amber-400',  border: 'border-amber-500/30',  swatch: 'bg-amber-500' },
  green:  { bg: 'bg-green-500/12',  text: 'text-green-400',  border: 'border-green-500/30',  swatch: 'bg-green-500' },
  teal:   { bg: 'bg-teal-500/12',   text: 'text-teal-400',   border: 'border-teal-500/30',   swatch: 'bg-teal-500' },
  blue:   { bg: 'bg-blue-500/12',   text: 'text-blue-400',   border: 'border-blue-500/30',   swatch: 'bg-blue-500' },
  indigo: { bg: 'bg-indigo-500/12', text: 'text-indigo-400', border: 'border-indigo-500/30', swatch: 'bg-indigo-500' },
  purple: { bg: 'bg-purple-500/12', text: 'text-purple-400', border: 'border-purple-500/30', swatch: 'bg-purple-500' },
  pink:   { bg: 'bg-pink-500/12',   text: 'text-pink-400',   border: 'border-pink-500/30',   swatch: 'bg-pink-500' },
  gray:   { bg: 'bg-gray-500/12',   text: 'text-gray-400',   border: 'border-gray-500/30',   swatch: 'bg-gray-500' }
}

export const BUILTIN_LABELS: LabelDefinition[] = [
  { id: 'draft',     name: 'Draft',     colorKey: 'gray',   builtIn: true },
  { id: 'in_review', name: 'In Review', colorKey: 'blue',   builtIn: true },
  { id: 'blocked',   name: 'Blocked',   colorKey: 'red',    builtIn: true },
  { id: 'done',      name: 'Done',      colorKey: 'green',  builtIn: true }
]

export const BUILTIN_LABEL_IDS = new Set<string>(BUILTIN_LABELS.map((l) => l.id))

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
  labelIds: string[]
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

export function isUrgent(agent: { status: AgentStatus; labelIds: string[] }): boolean {
  return isBlocked(agent.status) || agent.status === 'errored' || agent.labelIds.includes('blocked')
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

export function getLabelDefinition(labelId: string | null, customLabels: LabelDefinition[] = []): LabelDefinition | null {
  if (!labelId) return null
  const builtin = BUILTIN_LABELS.find((l) => l.id === labelId)
  if (builtin) return builtin
  return customLabels.find((l) => l.id === labelId) ?? null
}

export function agentLabelDisplay(labelId: string | null, customLabels: LabelDefinition[] = []): string {
  if (!labelId) return 'None'
  const def = getLabelDefinition(labelId, customLabels)
  return def?.name ?? labelId
}

function resolveNames(labelIds: string[], allLabels: LabelDefinition[]): string[] {
  return labelIds
    .map((id) => getLabelDefinition(id, allLabels)?.name ?? id)
    .sort((a, b) => a.localeCompare(b))
}

export function agentLabelsDisplay(labelIds: string[], customLabels: LabelDefinition[] = []): string {
  if (labelIds.length === 0) return 'None'
  return resolveNames(labelIds, customLabels).join(', ')
}

export function labelSortKey(labelIds: string[], allLabels: LabelDefinition[] = []): string {
  if (labelIds.length === 0) return '\uffff'
  return resolveNames(labelIds, allLabels).join(',').toLowerCase()
}
