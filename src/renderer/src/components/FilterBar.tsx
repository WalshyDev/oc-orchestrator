import { MagnifyingGlass } from '@phosphor-icons/react'
import type { AgentStatus, LabelDefinition } from '../types'
import { LABEL_COLORS } from '../types'

export type StatusFilter = 'blocked' | 'running' | 'idle' | 'errored' | 'completed'
export type LabelFilter = string

export type FilterMode = 'include' | 'exclude'

export interface FilterState {
  statuses: Set<StatusFilter>
  labels: Set<LabelFilter>
  projects: Set<string>
  excludeStatuses: Set<StatusFilter>
  excludeLabels: Set<LabelFilter>
  excludeProjects: Set<string>
}

export const EMPTY_FILTER: FilterState = {
  statuses: new Set(),
  labels: new Set(),
  projects: new Set(),
  excludeStatuses: new Set(),
  excludeLabels: new Set(),
  excludeProjects: new Set()
}

const FILTER_STORAGE_KEY = 'oc-orchestrator:filter'
const SEARCH_STORAGE_KEY = 'oc-orchestrator:search'

interface SerializedFilterState {
  statuses: StatusFilter[]
  labels: LabelFilter[]
  projects: string[]
  excludeStatuses: StatusFilter[]
  excludeLabels: LabelFilter[]
  excludeProjects: string[]
}

function serializeFilter(filter: FilterState): string {
  const obj: SerializedFilterState = {
    statuses: [...filter.statuses],
    labels: [...filter.labels],
    projects: [...filter.projects],
    excludeStatuses: [...filter.excludeStatuses],
    excludeLabels: [...filter.excludeLabels],
    excludeProjects: [...filter.excludeProjects]
  }
  return JSON.stringify(obj)
}

function deserializeFilter(json: string): FilterState {
  const obj = JSON.parse(json) as SerializedFilterState
  return {
    statuses: new Set(obj.statuses ?? []),
    labels: new Set(obj.labels ?? []),
    projects: new Set(obj.projects ?? []),
    excludeStatuses: new Set(obj.excludeStatuses ?? []),
    excludeLabels: new Set(obj.excludeLabels ?? []),
    excludeProjects: new Set(obj.excludeProjects ?? [])
  }
}

export function loadPersistedFilter(): FilterState {
  try {
    const stored = localStorage.getItem(FILTER_STORAGE_KEY)
    if (!stored) return EMPTY_FILTER
    return deserializeFilter(stored)
  } catch {
    return EMPTY_FILTER
  }
}

export function persistFilter(filter: FilterState): void {
  localStorage.setItem(FILTER_STORAGE_KEY, serializeFilter(filter))
}

export function loadPersistedSearch(): string {
  try {
    return localStorage.getItem(SEARCH_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function persistSearch(query: string): void {
  localStorage.setItem(SEARCH_STORAGE_KEY, query)
}

export function isFilterEmpty(filter: FilterState): boolean {
  return (
    filter.statuses.size === 0 &&
    filter.labels.size === 0 &&
    filter.projects.size === 0 &&
    filter.excludeStatuses.size === 0 &&
    filter.excludeLabels.size === 0 &&
    filter.excludeProjects.size === 0
  )
}

export function getFilterMode(
  includeSet: Set<unknown>,
  excludeSet: Set<unknown>,
  value: unknown
): FilterMode | null {
  if (includeSet.has(value)) return 'include'
  if (excludeSet.has(value)) return 'exclude'
  return null
}

export function cycleFilter<T>(includeSet: Set<T>, excludeSet: Set<T>, value: T): { include: Set<T>; exclude: Set<T> } {
  const nextInclude = new Set(includeSet)
  const nextExclude = new Set(excludeSet)

  if (nextInclude.has(value)) {
    nextInclude.delete(value)
    nextExclude.add(value)
  } else if (nextExclude.has(value)) {
    nextExclude.delete(value)
  } else {
    nextInclude.add(value)
  }

  return { include: nextInclude, exclude: nextExclude }
}

interface FilterBarProps {
  filter: FilterState
  onCycleStatus: (status: StatusFilter) => void
  onCycleLabel: (label: LabelFilter) => void
  onCycleProject: (project: string) => void
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
  labelCounts: Record<string, number>
  allLabels: LabelDefinition[]
  projects: string[]
}

export function FilterBar({
  filter,
  onCycleStatus,
  onCycleLabel,
  onCycleProject,
  onClearFilters,
  searchQuery,
  onSearchChange,
  counts,
  labelCounts,
  allLabels,
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
      <FilterPill label={`All (${counts.all})`} mode={noFilters ? 'include' : null} onClick={onClearFilters} />
      <FilterPill label={`Blocked (${counts.blocked})`} mode={getFilterMode(filter.statuses, filter.excludeStatuses, 'blocked')} onClick={() => onCycleStatus('blocked')} />
      <FilterPill label={`Running (${counts.running})`} mode={getFilterMode(filter.statuses, filter.excludeStatuses, 'running')} onClick={() => onCycleStatus('running')} />
      <FilterPill label={`Idle (${counts.idle})`} mode={getFilterMode(filter.statuses, filter.excludeStatuses, 'idle')} onClick={() => onCycleStatus('idle')} />
      <FilterPill label={`Errored (${counts.errored})`} mode={getFilterMode(filter.statuses, filter.excludeStatuses, 'errored')} onClick={() => onCycleStatus('errored')} />
      <FilterPill label={`Completed (${counts.completed})`} mode={getFilterMode(filter.statuses, filter.excludeStatuses, 'completed')} onClick={() => onCycleStatus('completed')} />

      {/* Label filters */}
      {Object.values(labelCounts).some((count) => count > 0) && (
        <>
          <div className="w-px h-5 bg-kumo-line" />
          {allLabels.map((labelDef) => {
            const count = labelCounts[labelDef.id]
            if (!count) return null
            return (
              <FilterPill
                key={labelDef.id}
                label={`${labelDef.name} (${count})`}
                mode={getFilterMode(filter.labels, filter.excludeLabels, labelDef.id)}
                onClick={() => onCycleLabel(labelDef.id)}
                labelDef={labelDef}
              />
            )
          })}
        </>
      )}

      <div className="w-px h-5 bg-kumo-line" />

      {/* Project filters */}
      {projects.map((project) => (
        <FilterPill
          key={project}
          label={project}
          mode={getFilterMode(filter.projects, filter.excludeProjects, project)}
          onClick={() => onCycleProject(project)}
        />
      ))}
    </div>
  )
}

const FILTER_TOOLTIPS: Record<string, string> = {
  include: 'Showing only matching agents. Click to exclude instead.',
  exclude: 'Hiding matching agents. Click to clear filter.',
  inactive: 'Click to include. Click again to exclude.'
}

function FilterPill({
  label,
  mode,
  onClick,
  labelDef
}: {
  label: string
  mode: FilterMode | null
  onClick: () => void
  labelDef?: LabelDefinition
}) {
  let modeClass: string
  if (mode === 'include') {
    if (labelDef) {
      const colors = LABEL_COLORS[labelDef.colorKey]
      modeClass = `${colors.bg} ${colors.border} ${colors.text}`
    } else {
      modeClass = 'bg-kumo-interact/12 border-kumo-interact/30 text-kumo-link'
    }
  } else if (mode === 'exclude') {
    modeClass = 'bg-red-500/12 border-red-500/30 text-red-400'
  } else {
    modeClass = 'bg-kumo-control border-kumo-line text-kumo-subtle hover:border-kumo-fill-hover hover:text-kumo-default'
  }

  const tooltip = mode ? FILTER_TOOLTIPS[mode] : FILTER_TOOLTIPS.inactive

  return (
    <button
      onClick={onClick}
      title={tooltip}
      className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] border transition-colors cursor-pointer ${modeClass}`}
    >
      {mode === 'exclude' && <span aria-hidden="true" className="text-[9px] leading-none">−</span>}
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

function expandStatuses(filters: Set<StatusFilter>): Set<AgentStatus> {
  const result = new Set<AgentStatus>()
  for (const sf of filters) {
    for (const s of STATUS_MAP[sf]) result.add(s)
  }
  return result
}

export function matchesFilter(
  agent: { status: AgentStatus; labelIds: string[]; projectName: string },
  filter: FilterState
): boolean {
  if (isFilterEmpty(filter)) return true

  // Exclude filters: reject if agent matches any excluded value
  if (filter.excludeStatuses.size > 0 && expandStatuses(filter.excludeStatuses).has(agent.status)) return false
  if (filter.excludeLabels.size > 0 && agent.labelIds.some((id) => filter.excludeLabels.has(id))) return false
  if (filter.excludeProjects.size > 0 && filter.excludeProjects.has(agent.projectName)) return false

  // Include filters: agent must match at least one value in each active include dimension
  if (filter.statuses.size > 0 && !expandStatuses(filter.statuses).has(agent.status)) return false
  if (filter.labels.size > 0 && !agent.labelIds.some((id) => filter.labels.has(id))) return false
  if (filter.projects.size > 0 && !filter.projects.has(agent.projectName)) return false

  return true
}
