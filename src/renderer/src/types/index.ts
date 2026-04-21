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
  | 'compacting'

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
  variant?: string
  prUrl: string | null
  lastActivityAt: string
  lastActivityAtMs: number
  blockedSince?: string
  blockedSinceMs?: number
  lastMessage?: string
  /** Most recent session-level error from the server (e.g. ContextOverflowError). */
  lastError?: AgentRuntimeError
  /** True while a compaction RPC is running (shows spinner, disables compact buttons). */
  compacting?: boolean
  /** Approximate tokens currently sitting in the model's context window. */
  contextTokens?: number
  /** Provider-reported context window size for the active model. */
  contextLimit?: number
}

export interface AgentRuntimeError {
  name: string
  message?: string
  occurredAt: number
}

// ── Column visibility ──

export type ColumnKey = 'agent' | 'status' | 'label' | 'task' | 'branch' | 'model' | 'lastMessage' | 'context'

export interface ColumnDef {
  key: ColumnKey
  label: string
  defaultVisible: boolean
  /** Relative flex weight — percentages are computed from visible columns at render time. */
  flex: number
}

export const ALL_COLUMNS: ColumnDef[] = [
  { key: 'agent',       label: 'Agent',        defaultVisible: true,  flex: 3 },
  { key: 'status',      label: 'Status',       defaultVisible: true,  flex: 2 },
  { key: 'label',       label: 'Label',        defaultVisible: true,  flex: 2 },
  { key: 'task',        label: 'Task',         defaultVisible: true,  flex: 4 },
  { key: 'lastMessage', label: 'Last Message', defaultVisible: true,  flex: 4 },
  { key: 'branch',      label: 'Branch',       defaultVisible: true,  flex: 2 },
  { key: 'model',       label: 'Model',        defaultVisible: true,  flex: 2 },
  // Context usage is hidden by default to keep the table compact; power users
  // can enable it via the column picker when they care about compaction timing.
  { key: 'context',     label: 'Context',      defaultVisible: false, flex: 2 },
]

const COLUMN_VIS_KEY = 'oc-orchestrator:column-visibility'
const COLUMN_WIDTHS_KEY = 'oc-orchestrator:column-widths'
const SORT_KEY = 'oc-orchestrator:sort'

export type SortDirection = 'asc' | 'desc'

export interface SortState {
  column: ColumnKey | null
  direction: SortDirection
}

export function loadSort(): SortState {
  try {
    const stored = localStorage.getItem(SORT_KEY)
    if (!stored) return { column: null, direction: 'asc' }
    return JSON.parse(stored) as SortState
  } catch {
    return { column: null, direction: 'asc' }
  }
}

export function saveSort(state: SortState): void {
  localStorage.setItem(SORT_KEY, JSON.stringify(state))
}

const DEFAULT_VISIBLE_COLUMNS = new Set<ColumnKey>(
  ALL_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key)
)

export function loadColumnVisibility(): Set<ColumnKey> {
  try {
    const stored = localStorage.getItem(COLUMN_VIS_KEY)
    if (!stored) return new Set(DEFAULT_VISIBLE_COLUMNS)
    return new Set(JSON.parse(stored) as ColumnKey[])
  } catch {
    return new Set(DEFAULT_VISIBLE_COLUMNS)
  }
}

export function saveColumnVisibility(visible: Set<ColumnKey>): void {
  localStorage.setItem(COLUMN_VIS_KEY, JSON.stringify([...visible]))
}

/** User-specified pixel widths per column. Missing keys fall back to flex-based sizing. */
export type ColumnWidths = Partial<Record<ColumnKey, number>>

export function loadColumnWidths(): ColumnWidths {
  try {
    const stored = localStorage.getItem(COLUMN_WIDTHS_KEY)
    if (!stored) return {}
    return JSON.parse(stored) as ColumnWidths
  } catch {
    return {}
  }
}

export function saveColumnWidths(widths: ColumnWidths): void {
  localStorage.setItem(COLUMN_WIDTHS_KEY, JSON.stringify(widths))
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
  role: 'user' | 'assistant' | 'tool' | 'tool-group' | 'compaction'
  content: string
  timestamp: string
  toolName?: string
  toolState?: 'running' | 'completed' | 'failed'
  toolCalls?: ToolCall[]
  images?: MessageImage[]
  /** For compaction rows: whether compaction is still running. */
  compactionActive?: boolean
  /** For compaction rows: whether the compaction was automatic (true) or user-initiated (false). */
  compactionAuto?: boolean
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
    stopping: 'Stopping',
    compacting: 'Compacting'
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

const STATUS_PRIORITY: Record<AgentStatus, number> = {
  needs_input: 0,
  needs_approval: 1,
  running: 2,
  compacting: 3,
  starting: 4,
  idle: 5,
  stopping: 6,
  errored: 7,
  completed: 8,
  disconnected: 9
}

export function compareStatusPriority(a: AgentStatus, b: AgentStatus): number {
  return STATUS_PRIORITY[a] - STATUS_PRIORITY[b]
}
