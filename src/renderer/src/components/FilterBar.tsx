import { MagnifyingGlass } from '@phosphor-icons/react'
import type { AgentStatus } from '../types'

export type FilterValue = 'all' | 'blocked' | 'running' | 'idle' | string

interface FilterBarProps {
  filter: FilterValue
  onFilterChange: (filter: FilterValue) => void
  searchQuery: string
  onSearchChange: (query: string) => void
  counts: {
    all: number
    blocked: number
    running: number
    idle: number
  }
  projects: string[]
}

export function FilterBar({
  filter,
  onFilterChange,
  searchQuery,
  onSearchChange,
  counts,
  projects
}: FilterBarProps) {
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
      <FilterPill label={`All (${counts.all})`} active={filter === 'all'} onClick={() => onFilterChange('all')} />
      <FilterPill label={`Blocked (${counts.blocked})`} active={filter === 'blocked'} onClick={() => onFilterChange('blocked')} />
      <FilterPill label={`Running (${counts.running})`} active={filter === 'running'} onClick={() => onFilterChange('running')} />
      <FilterPill label={`Idle (${counts.idle})`} active={filter === 'idle'} onClick={() => onFilterChange('idle')} />

      <div className="w-px h-5 bg-kumo-line" />

      {/* Project filters */}
      {projects.map((project) => (
        <FilterPill
          key={project}
          label={project}
          active={filter === project}
          onClick={() => onFilterChange(filter === project ? 'all' : project)}
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

export function matchesFilter(agent: { status: AgentStatus; projectName: string }, filter: FilterValue): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'blocked':
      return agent.status === 'needs_input' || agent.status === 'needs_approval'
    case 'running':
      return agent.status === 'running'
    case 'idle':
      return agent.status === 'idle' || agent.status === 'completed'
    default:
      return agent.projectName === filter
  }
}
