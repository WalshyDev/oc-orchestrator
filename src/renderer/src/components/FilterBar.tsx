import { MagnifyingGlass } from '@phosphor-icons/react'
import type { AgentStatus } from '../types'

export type StatusFilter = 'blocked' | 'running' | 'idle' | 'in_review' | 'completed'

export interface FilterState {
  statuses: Set<StatusFilter>
  projects: Set<string>
}

export const EMPTY_FILTER: FilterState = {
  statuses: new Set(),
  projects: new Set()
}

export function isFilterEmpty(filter: FilterState): boolean {
  return filter.statuses.size === 0 && filter.projects.size === 0
}

interface FilterBarProps {
  filter: FilterState
  onToggleStatus: (status: StatusFilter) => void
  onToggleProject: (project: string) => void
  onClearFilters: () => void
  searchQuery: string
  onSearchChange: (query: string) => void
  counts: {
    all: number
    blocked: number
    running: number
    idle: number
    in_review: number
    completed: number
  }
  projects: string[]
}

export function FilterBar({
  filter,
  onToggleStatus,
  onToggleProject,
  onClearFilters,
  searchQuery,
  onSearchChange,
  counts,
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
      <FilterPill label={`In Review (${counts.in_review})`} active={filter.statuses.has('in_review')} onClick={() => onToggleStatus('in_review')} />
      <FilterPill label={`Completed (${counts.completed})`} active={filter.statuses.has('completed')} onClick={() => onToggleStatus('completed')} />

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
  onClick
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] border transition-colors cursor-pointer ${
        active
          ? 'bg-kumo-interact/12 border-kumo-interact/30 text-kumo-link'
          : 'bg-kumo-control border-kumo-line text-kumo-subtle hover:border-kumo-fill-hover hover:text-kumo-default'
      }`}
    >
      {label}
    </button>
  )
}

const STATUS_MAP: Record<StatusFilter, AgentStatus[]> = {
  blocked: ['needs_input', 'needs_approval', 'blocked_manual'],
  running: ['running'],
  idle: ['idle'],
  in_review: ['in_review'],
  completed: ['completed', 'completed_manual']
}

export function matchesFilter(
  agent: { status: AgentStatus; projectName: string },
  filter: FilterState
): boolean {
  const hasStatuses = filter.statuses.size > 0
  const hasProjects = filter.projects.size > 0

  if (!hasStatuses && !hasProjects) return true

  if (hasStatuses) {
    const allowedStatuses = new Set<AgentStatus>()
    for (const sf of filter.statuses) {
      for (const s of STATUS_MAP[sf]) allowedStatuses.add(s)
    }
    if (!allowedStatuses.has(agent.status)) return false
  }

  if (hasProjects) {
    if (!filter.projects.has(agent.projectName)) return false
  }

  return true
}
