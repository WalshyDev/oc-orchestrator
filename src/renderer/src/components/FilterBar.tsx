import { MagnifyingGlass } from '@phosphor-icons/react'
import type { AgentStatus, AgentLabel } from '../types'

export type StatusFilter = 'blocked' | 'running' | 'idle' | 'errored' | 'completed'
export type LabelFilter = AgentLabel

export interface FilterState {
  statuses: Set<StatusFilter>
  labels: Set<LabelFilter>
  projects: Set<string>
}

export const EMPTY_FILTER: FilterState = {
  statuses: new Set(),
  labels: new Set(),
  projects: new Set()
}

export function isFilterEmpty(filter: FilterState): boolean {
  return filter.statuses.size === 0 && filter.labels.size === 0 && filter.projects.size === 0
}

interface FilterBarProps {
  filter: FilterState
  onToggleStatus: (status: StatusFilter) => void
  onToggleLabel: (label: LabelFilter) => void
  onToggleProject: (project: string) => void
  onClearFilters: () => void
  searchQuery: string
  onSearchChange: (query: string) => void
  counts: {
    all: number
    blocked: number
    running: number
    idle: number
    errored: number
    completed: number
  }
  labelCounts: {
    in_review: number
    blocked: number
    done: number
    draft: number
  }
  projects: string[]
}

export function FilterBar({
  filter,
  onToggleStatus,
  onToggleLabel,
  onToggleProject,
  onClearFilters,
  searchQuery,
  onSearchChange,
  counts,
  labelCounts,
  projects
}: FilterBarProps) {
  const noFilters = isFilterEmpty(filter)

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-kumo-elevated border-b border-kumo-line shrink-0">
      {/* Search */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-kumo-control border border-kumo-line rounded-md w-56">
        <MagnifyingGlass size={13} className="text-kumo-subtle shrink-0" />
        <input
          type="text"
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Filter agents..."
          className="bg-transparent border-none outline-none text-kumo-default text-xs font-sans w-full placeholder:text-kumo-subtle"
        />
        <kbd className="font-mono text-[10px] px-1 py-px bg-kumo-fill rounded border border-kumo-line text-kumo-subtle shrink-0">/</kbd>
      </div>

      <div className="w-px h-5 bg-kumo-line" />

      {/* Status filters */}
      <FilterPill label={`All (${counts.all})`} active={noFilters} onClick={onClearFilters} />
      <FilterPill label={`Blocked (${counts.blocked})`} active={filter.statuses.has('blocked')} onClick={() => onToggleStatus('blocked')} />
      <FilterPill label={`Running (${counts.running})`} active={filter.statuses.has('running')} onClick={() => onToggleStatus('running')} />
      <FilterPill label={`Idle (${counts.idle})`} active={filter.statuses.has('idle')} onClick={() => onToggleStatus('idle')} />
      <FilterPill label={`Errored (${counts.errored})`} active={filter.statuses.has('errored')} onClick={() => onToggleStatus('errored')} />
      <FilterPill label={`Completed (${counts.completed})`} active={filter.statuses.has('completed')} onClick={() => onToggleStatus('completed')} />

      {/* Label filters */}
      {Object.values(labelCounts).some((count) => count > 0) && (
        <>
          <div className="w-px h-5 bg-kumo-line" />
          {labelCounts.draft > 0 && (
            <FilterPill label={`Draft (${labelCounts.draft})`} active={filter.labels.has('draft')} onClick={() => onToggleLabel('draft')} variant="label" />
          )}
          {labelCounts.in_review > 0 && (
            <FilterPill label={`Review (${labelCounts.in_review})`} active={filter.labels.has('in_review')} onClick={() => onToggleLabel('in_review')} variant="label" />
          )}
          {labelCounts.blocked > 0 && (
            <FilterPill label={`Blocked (${labelCounts.blocked})`} active={filter.labels.has('blocked')} onClick={() => onToggleLabel('blocked')} variant="label" />
          )}
          {labelCounts.done > 0 && (
            <FilterPill label={`Done (${labelCounts.done})`} active={filter.labels.has('done')} onClick={() => onToggleLabel('done')} variant="label" />
          )}
        </>
      )}

      <div className="w-px h-5 bg-kumo-line" />

      {/* Project filters */}
      {projects.map((project) => (
        <FilterPill
          key={project}
          label={project}
          active={filter.projects.has(project)}
          onClick={() => onToggleProject(project)}
        />
      ))}
    </div>
  )
}

function FilterPill({
  label,
  active,
  onClick,
  variant = 'status'
}: {
  label: string
  active: boolean
  onClick: () => void
  variant?: 'status' | 'label'
}) {
  const activeClass = variant === 'label'
    ? 'bg-kumo-brand/12 border-kumo-brand/30 text-kumo-brand'
    : 'bg-kumo-interact/12 border-kumo-interact/30 text-kumo-link'

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] border transition-colors cursor-pointer ${
        active
          ? activeClass
          : 'bg-kumo-control border-kumo-line text-kumo-subtle hover:border-kumo-fill-hover hover:text-kumo-default'
      }`}
    >
      {label}
    </button>
  )
}

const STATUS_MAP: Record<StatusFilter, AgentStatus[]> = {
  blocked: ['needs_input', 'needs_approval'],
  running: ['running'],
  idle: ['idle'],
  errored: ['errored'],
  completed: ['completed']
}

export function matchesFilter(
  agent: { status: AgentStatus; label: AgentLabel | null; projectName: string },
  filter: FilterState
): boolean {
  const hasStatuses = filter.statuses.size > 0
  const hasLabels = filter.labels.size > 0
  const hasProjects = filter.projects.size > 0

  if (!hasStatuses && !hasLabels && !hasProjects) return true

  if (hasStatuses) {
    const allowedStatuses = new Set<AgentStatus>()
    for (const sf of filter.statuses) {
      for (const s of STATUS_MAP[sf]) allowedStatuses.add(s)
    }
    if (!allowedStatuses.has(agent.status)) return false
  }

  if (hasLabels) {
    if (!agent.label || !filter.labels.has(agent.label)) return false
  }

  if (hasProjects) {
    if (!filter.projects.has(agent.projectName)) return false
  }

  return true
}
