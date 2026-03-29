import { useState, useCallback, useMemo } from 'react'
import {
  ArrowRight,
  CaretUp,
  CaretDown,
  Check,
  Pause,
  PencilSimple,
  Square,
  Robot,
  Stop,
  CheckCircle
} from '@phosphor-icons/react'
import type { AgentRuntime } from '../types'
import { formatBranchLabel, isUrgent } from '../types'
import { StatusBadge } from './StatusBadge'

interface FleetTableProps {
  agents: AgentRuntime[]
  selectedId: string | null
  onSelect: (id: string) => void
  selectedIds?: Set<string>
  onSelectionChange?: (ids: Set<string>) => void
  onSort?: (column: string, direction: 'asc' | 'desc') => void
  onApprove?: (agentId: string) => void
  onReply?: (agentId: string) => void
  onStop?: (agentId: string) => void
  onOpen?: (agentId: string) => void
}

type SortColumn = 'agent' | 'status' | 'task' | 'branch' | 'model' | 'activity'
type SortDirection = 'asc' | 'desc'

const SORTABLE_COLUMNS: { key: SortColumn; label: string }[] = [
  { key: 'agent', label: 'Agent' },
  { key: 'status', label: 'Status' },
  { key: 'task', label: 'Task' },
  { key: 'branch', label: 'Branch' },
  { key: 'model', label: 'Model' },
  { key: 'activity', label: 'Activity' }
]

export function FleetTable({
  agents,
  selectedId,
  onSelect,
  selectedIds = new Set(),
  onSelectionChange,
  onSort,
  onApprove,
  onReply,
  onStop,
  onOpen
}: FleetTableProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null)
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')

  const handleSort = useCallback((column: SortColumn) => {
    let nextDirection: SortDirection = 'asc'
    if (sortColumn === column) {
      nextDirection = sortDirection === 'asc' ? 'desc' : 'asc'
    }
    setSortColumn(column)
    setSortDirection(nextDirection)
    onSort?.(column, nextDirection)
  }, [sortColumn, sortDirection, onSort])

  const allSelected = agents.length > 0 && agents.every((agent) => selectedIds.has(agent.id))
  const someSelected = agents.some((agent) => selectedIds.has(agent.id))

  const handleSelectAll = useCallback(() => {
    if (!onSelectionChange) return
    if (allSelected) {
      onSelectionChange(new Set())
    } else {
      onSelectionChange(new Set(agents.map((agent) => agent.id)))
    }
  }, [agents, allSelected, onSelectionChange])

  const handleToggleSelection = useCallback((agentId: string) => {
    if (!onSelectionChange) return
    const nextIds = new Set(selectedIds)
    if (nextIds.has(agentId)) {
      nextIds.delete(agentId)
    } else {
      nextIds.add(agentId)
    }
    onSelectionChange(nextIds)
  }, [selectedIds, onSelectionChange])

  const handleBulkStop = useCallback(() => {
    if (!onStop) return
    Array.from(selectedIds).forEach((agentId) => onStop(agentId))
  }, [selectedIds, onStop])

  const handleBulkApprove = useCallback(() => {
    if (!onApprove) return
    Array.from(selectedIds).forEach((agentId) => onApprove(agentId))
  }, [selectedIds, onApprove])

  const sortedAgents = useMemo(() => {
    if (!sortColumn) return agents

    const sorted = [...agents].sort((left, right) => {
      let leftVal: string
      let rightVal: string

      switch (sortColumn) {
        case 'agent':
          leftVal = left.name.toLowerCase()
          rightVal = right.name.toLowerCase()
          break
        case 'status':
          leftVal = left.status
          rightVal = right.status
          break
        case 'task':
          leftVal = (left.taskSummary || '').toLowerCase()
          rightVal = (right.taskSummary || '').toLowerCase()
          break
        case 'branch':
          leftVal = (left.branchName || '').toLowerCase()
          rightVal = (right.branchName || '').toLowerCase()
          break
        case 'model':
          leftVal = (left.model || '').toLowerCase()
          rightVal = (right.model || '').toLowerCase()
          break
        case 'activity':
          leftVal = left.lastActivityAt || ''
          rightVal = right.lastActivityAt || ''
          break
        default:
          return 0
      }

      if (leftVal < rightVal) return sortDirection === 'asc' ? -1 : 1
      if (leftVal > rightVal) return sortDirection === 'asc' ? 1 : -1
      return 0
    })

    return sorted
  }, [agents, sortColumn, sortDirection])

  const headerCellClass = 'px-3 py-2 text-left font-medium text-[11px] uppercase tracking-wide text-kumo-subtle bg-kumo-overlay border-b border-kumo-line cursor-pointer hover:text-kumo-default select-none'

  const renderSortIndicator = (column: SortColumn) => {
    if (sortColumn !== column) return null
    return sortDirection === 'asc'
      ? <CaretUp size={10} weight="bold" className="inline ml-0.5" />
      : <CaretDown size={10} weight="bold" className="inline ml-0.5" />
  }

  if (agents.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-kumo-subtle py-16">
        <Robot size={48} weight="thin" className="mb-3 text-kumo-muted" />
        <p className="text-sm font-medium text-kumo-default mb-1">No agents found</p>
        <p className="text-xs text-kumo-subtle">No agents match the current filters. Try adjusting your search or filters.</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto">
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 bg-kumo-overlay border-b border-kumo-line">
          <span className="text-xs text-kumo-default font-medium">
            {selectedIds.size} selected
          </span>
          <div className="flex gap-1.5 ml-2">
            <button
              onClick={handleBulkStop}
              className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded bg-kumo-fill border border-kumo-line text-kumo-subtle hover:bg-kumo-fill-hover hover:text-kumo-default transition-colors"
            >
              <Stop size={11} weight="fill" />
              Stop All
            </button>
            <button
              onClick={handleBulkApprove}
              className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded bg-kumo-fill border border-kumo-line text-kumo-subtle hover:bg-kumo-fill-hover hover:text-kumo-default transition-colors"
            >
              <CheckCircle size={11} weight="bold" />
              Approve All
            </button>
          </div>
        </div>
      )}
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 z-10">
          <tr>
            <th className="w-8 px-3 py-2 text-left bg-kumo-overlay border-b border-kumo-line">
              <input
                type="checkbox"
                className="accent-kumo-brand"
                checked={allSelected}
                ref={(input) => {
                  if (input) input.indeterminate = someSelected && !allSelected
                }}
                onChange={handleSelectAll}
              />
            </th>
            {SORTABLE_COLUMNS.map((col) => (
              <th
                key={col.key}
                className={headerCellClass}
                onClick={() => handleSort(col.key)}
              >
                {col.label}
                {renderSortIndicator(col.key)}
              </th>
            ))}
            <th className="w-24 px-3 py-2 bg-kumo-overlay border-b border-kumo-line" />
          </tr>
        </thead>
        <tbody>
          {sortedAgents.map((agent) => (
            <AgentRow
              key={agent.id}
              agent={agent}
              selected={agent.id === selectedId}
              checked={selectedIds.has(agent.id)}
              onSelect={() => onSelect(agent.id)}
              onToggleSelection={() => handleToggleSelection(agent.id)}
              onApprove={onApprove ? () => onApprove(agent.id) : undefined}
              onReply={onReply ? () => onReply(agent.id) : undefined}
              onStop={onStop ? () => onStop(agent.id) : undefined}
              onOpen={onOpen ? () => onOpen(agent.id) : () => onSelect(agent.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AgentRow({
  agent,
  selected,
  checked,
  onSelect,
  onToggleSelection,
  onApprove,
  onReply,
  onStop,
  onOpen
}: {
  agent: AgentRuntime
  selected: boolean
  checked: boolean
  onSelect: () => void
  onToggleSelection: () => void
  onApprove?: () => void
  onReply?: () => void
  onStop?: () => void
  onOpen?: () => void
}) {
  const urgent = isUrgent(agent)
  const isStale = !!agent.blockedSince

  return (
    <tr
      onClick={onSelect}
      className={`group cursor-pointer transition-colors border-b border-kumo-line ${
        selected
          ? 'bg-kumo-control'
          : urgent
            ? 'bg-kumo-danger/[0.04] hover:bg-kumo-danger/[0.08]'
            : 'hover:bg-kumo-control'
      }`}
    >
      <td className="px-3 py-2">
        <input
          type="checkbox"
          className="accent-kumo-brand"
          checked={checked}
          onChange={onToggleSelection}
          onClick={(event) => event.stopPropagation()}
        />
      </td>
      <td className="px-3 py-2">
        <div className="font-semibold text-kumo-strong">{agent.name}</div>
        <div className="text-[11px] text-kumo-subtle">
          {agent.projectName}
          {agent.isWorktree ? ` · worktree:${agent.workspaceName}` : ''}
        </div>
      </td>
      <td className="px-3 py-2">
        <StatusBadge status={agent.status} />
      </td>
      <td className="px-3 py-2 max-w-80 truncate text-kumo-default">
        {agent.taskSummary}
      </td>
      <td className="px-3 py-2 font-mono text-[11px] text-kumo-subtle">
        {formatBranchLabel(agent)}
      </td>
      <td className="px-3 py-2">
        <span className="font-mono text-[10px] px-1.5 py-0.5 bg-kumo-fill rounded text-kumo-subtle">
          {agent.model}
        </span>
      </td>
      <td className="px-3 py-2">
        <span className={`font-mono text-[11px] ${isStale ? 'text-kumo-danger font-medium' : 'text-kumo-subtle'}`}>
          {agent.lastActivityAt}
        </span>
      </td>
      <td className="px-3 py-2">
        <RowActions
          agent={agent}
          onApprove={onApprove}
          onReply={onReply}
          onStop={onStop}
          onOpen={onOpen}
        />
      </td>
    </tr>
  )
}

function RowActions({
  agent,
  onApprove,
  onReply,
  onStop,
  onOpen
}: {
  agent: AgentRuntime
  onApprove?: () => void
  onReply?: () => void
  onStop?: () => void
  onOpen?: () => void
}) {
  const buttonBase = 'w-6 h-6 flex items-center justify-center bg-kumo-fill border border-kumo-line rounded text-kumo-subtle hover:bg-kumo-fill-hover hover:text-kumo-default transition-colors'

  return (
    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
      {agent.status === 'needs_approval' && (
        <button
          className={buttonBase}
          title="Approve"
          onClick={(event) => { event.stopPropagation(); onApprove?.() }}
        >
          <Check size={12} weight="bold" />
        </button>
      )}
      {agent.status === 'needs_input' && (
        <button
          className={buttonBase}
          title="Reply"
          onClick={(event) => { event.stopPropagation(); onReply?.() }}
        >
          <PencilSimple size={12} weight="bold" />
        </button>
      )}
      {agent.status === 'running' && (
        <button
          className={buttonBase}
          title="Pause"
          onClick={(event) => { event.stopPropagation(); onStop?.() }}
        >
          <Pause size={12} weight="bold" />
        </button>
      )}
      <button
        className={buttonBase}
        title="Open"
        onClick={(event) => { event.stopPropagation(); onOpen?.() }}
      >
        <ArrowRight size={12} weight="bold" />
      </button>
      {(agent.status === 'running' || agent.status === 'needs_input' || agent.status === 'needs_approval') && (
        <button
          className={buttonBase}
          title="Stop"
          onClick={(event) => { event.stopPropagation(); onStop?.() }}
        >
          <Square size={12} weight="fill" />
        </button>
      )}
    </div>
  )
}
