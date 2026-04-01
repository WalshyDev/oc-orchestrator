import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import {
  ArrowRight,
  CaretUp,
  CaretDown,
  Check,
  GearSix,
  Pause,
  PencilSimple,
  Square,
  Robot,
  Trash,
  Terminal,
  GitPullRequest,
  ArrowSquareOut
} from '@phosphor-icons/react'
import type { AgentRuntime } from '../types'
import { formatBranchLabel, isUrgent } from '../types'
import { StatusBadge } from './StatusBadge'

interface FleetTableProps {
  agents: AgentRuntime[]
  selectedId: string | null
  onSelect: (id: string) => void
  onSort?: (column: string, direction: 'asc' | 'desc') => void
  onApprove?: (agentId: string) => void
  onReply?: (agentId: string) => void
  onStop?: (agentId: string) => void
  onOpen?: (agentId: string) => void
  onRemove?: (agentId: string) => void
  onRename?: (agentId: string, newName: string) => void
  onOpenTerminal?: (agentId: string) => void
  onOpenInEditor?: (agentId: string) => void
  onCreatePr?: (agentId: string) => void
  onChangeModel?: (agentId: string) => void
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

interface ContextMenuState {
  agentId: string
  posX: number
  posY: number
}

interface RenameState {
  agentId: string
  currentName: string
}

export function FleetTable({
  agents,
  selectedId,
  onSelect,
  onSort,
  onApprove,
  onReply,
  onStop,
  onOpen,
  onRemove,
  onRename,
  onOpenTerminal,
  onOpenInEditor,
  onCreatePr,
  onChangeModel
}: FleetTableProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null)
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [renameState, setRenameState] = useState<RenameState | null>(null)

  const handleSort = useCallback((column: SortColumn) => {
    let nextDirection: SortDirection = 'asc'
    if (sortColumn === column) {
      nextDirection = sortDirection === 'asc' ? 'desc' : 'asc'
    }
    setSortColumn(column)
    setSortDirection(nextDirection)
    onSort?.(column, nextDirection)
  }, [sortColumn, sortDirection, onSort])

  const handleContextMenu = useCallback((event: React.MouseEvent, agentId: string) => {
    event.preventDefault()
    setContextMenu({ agentId, posX: event.clientX, posY: event.clientY })
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

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
    <div className="flex-1 overflow-auto" onClick={closeContextMenu}>
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 z-10">
          <tr>
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
              onSelect={() => onSelect(agent.id)}
              onContextMenu={(event) => handleContextMenu(event, agent.id)}
              onApprove={onApprove ? () => onApprove(agent.id) : undefined}
              onReply={onReply ? () => onReply(agent.id) : undefined}
              onStop={onStop ? () => onStop(agent.id) : undefined}
              onOpen={onOpen ? () => onOpen(agent.id) : () => onSelect(agent.id)}
              onRemove={onRemove ? () => onRemove(agent.id) : undefined}
              onChangeModel={onChangeModel ? () => onChangeModel(agent.id) : undefined}
            />
          ))}
        </tbody>
      </table>

      {contextMenu && (
        <ContextMenu
          agent={agents.find((agent) => agent.id === contextMenu.agentId)!}
          posX={contextMenu.posX}
          posY={contextMenu.posY}
          onClose={closeContextMenu}
          onRename={() => {
            const agent = agents.find((agnt) => agnt.id === contextMenu.agentId)
            if (agent) setRenameState({ agentId: agent.id, currentName: agent.name })
            closeContextMenu()
          }}
          onOpen={() => {
            onOpen?.(contextMenu.agentId)
            closeContextMenu()
          }}
          onStop={() => {
            onStop?.(contextMenu.agentId)
            closeContextMenu()
          }}
          onApprove={() => {
            onApprove?.(contextMenu.agentId)
            closeContextMenu()
          }}
          onRemove={() => {
            onRemove?.(contextMenu.agentId)
            closeContextMenu()
          }}
          onOpenTerminal={() => {
            onOpenTerminal?.(contextMenu.agentId)
            closeContextMenu()
          }}
          onOpenInEditor={() => {
            onOpenInEditor?.(contextMenu.agentId)
            closeContextMenu()
          }}
          onCreatePr={() => {
            onCreatePr?.(contextMenu.agentId)
            closeContextMenu()
          }}
        />
      )}

      {renameState && (
        <RenameModal
          currentName={renameState.currentName}
          onSubmit={(newName) => {
            onRename?.(renameState.agentId, newName)
            setRenameState(null)
          }}
          onClose={() => setRenameState(null)}
        />
      )}
    </div>
  )
}

function RenameModal({
  currentName,
  onSubmit,
  onClose
}: {
  currentName: string
  onSubmit: (newName: string) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(currentName)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const handleSubmit = () => {
    const trimmed = value.trim()
    if (trimmed) {
      onSubmit(trimmed)
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      handleSubmit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-80 rounded-lg border border-kumo-line bg-kumo-elevated p-4 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="text-sm font-semibold text-kumo-strong mb-3">Rename Agent</div>
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          className="w-full px-2.5 py-1.5 bg-kumo-control border border-kumo-line rounded-md text-sm text-kumo-default outline-none focus:border-kumo-ring"
        />
        <div className="flex justify-end gap-2 mt-3">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-kumo-line text-kumo-default hover:bg-kumo-fill transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!value.trim()}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-kumo-brand text-white hover:bg-kumo-brand-hover transition-colors disabled:opacity-40"
          >
            Rename
          </button>
        </div>
      </div>
    </div>
  )
}

function ContextMenu({
  agent,
  posX,
  posY,
  onClose,
  onRename,
  onOpen,
  onStop,
  onApprove,
  onRemove,
  onOpenTerminal,
  onOpenInEditor,
  onCreatePr
}: {
  agent: AgentRuntime
  posX: number
  posY: number
  onClose: () => void
  onRename: () => void
  onOpen: () => void
  onStop: () => void
  onApprove: () => void
  onRemove: () => void
  onOpenTerminal: () => void
  onOpenInEditor: () => void
  onCreatePr: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose()
      }
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  useEffect(() => {
    if (!menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    if (rect.bottom > window.innerHeight) {
      menuRef.current.style.top = `${posY - rect.height}px`
    }
    if (rect.right > window.innerWidth) {
      menuRef.current.style.left = `${posX - rect.width}px`
    }
  }, [posX, posY])

  const isRunning = agent.status === 'running' || agent.status === 'needs_approval' || agent.status === 'needs_input'
  const isStopping = agent.status === 'stopping'

  const itemClass = 'flex items-center gap-2 w-full px-2.5 py-1.5 text-[11px] text-kumo-default rounded hover:bg-kumo-fill transition-colors text-left'
  const dangerItemClass = 'flex items-center gap-2 w-full px-2.5 py-1.5 text-[11px] text-kumo-danger rounded hover:bg-kumo-danger/10 transition-colors text-left'

  return (
    <div
      ref={menuRef}
      style={{ left: posX, top: posY }}
      className="fixed z-[100] min-w-[180px] rounded-lg border border-kumo-line bg-kumo-elevated p-1 shadow-xl"
    >
      <button className={itemClass} onClick={onRename}>
        <PencilSimple size={13} /> Rename
      </button>
      <button className={itemClass} onClick={onOpen}>
        <ArrowRight size={13} /> Open
      </button>

      <div className="my-1 border-t border-kumo-line" />

      {agent.status === 'needs_approval' && (
        <button className={itemClass} onClick={onApprove}>
          <Check size={13} weight="bold" /> Approve
        </button>
      )}
      {(isRunning || isStopping) && (
        <button className={itemClass} onClick={onStop} disabled={isStopping}>
          <Square size={13} weight="fill" /> {isStopping ? 'Stopping…' : 'Stop'}
        </button>
      )}
      <button className={itemClass} onClick={onCreatePr}>
        <GitPullRequest size={13} /> Create PR
      </button>

      <div className="my-1 border-t border-kumo-line" />

      <button className={itemClass} onClick={onOpenTerminal}>
        <Terminal size={13} /> Open Terminal
      </button>
      <button className={itemClass} onClick={onOpenInEditor}>
        <ArrowSquareOut size={13} /> Open in Editor
      </button>

      <div className="my-1 border-t border-kumo-line" />

      <button className={dangerItemClass} onClick={onRemove}>
        <Trash size={13} /> Remove
      </button>
    </div>
  )
}

function AgentRow({
  agent,
  selected,
  onSelect,
  onContextMenu,
  onApprove,
  onReply,
  onStop,
  onOpen,
  onRemove,
  onChangeModel
}: {
  agent: AgentRuntime
  selected: boolean
  onSelect: () => void
  onContextMenu: (event: React.MouseEvent) => void
  onApprove?: () => void
  onReply?: () => void
  onStop?: () => void
  onOpen?: () => void
  onRemove?: () => void
  onChangeModel?: () => void
}) {
  const urgent = isUrgent(agent)
  const isStale = !!agent.blockedSince

  return (
    <tr
      onClick={onSelect}
      onContextMenu={onContextMenu}
      className={`group cursor-pointer transition-colors border-b border-kumo-line ${
        selected
          ? 'bg-kumo-control'
          : urgent
            ? 'bg-kumo-danger/[0.04] hover:bg-kumo-danger/[0.08]'
            : 'hover:bg-kumo-control'
      }`}
    >
      <td className="px-3 py-2">
        <div className="font-semibold text-kumo-strong">{agent.name}</div>
        <div className="flex items-center gap-1 text-[11px] text-kumo-subtle">
          {agent.isWorktree && (
            <span className="shrink-0 px-1 py-px rounded bg-kumo-brand/10 text-kumo-brand text-[9px] font-medium leading-tight">
              WT
            </span>
          )}
          <span className="truncate">{agent.projectName}</span>
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
        {agent.model && agent.model !== 'starting...' && (
          <button
            onClick={(event) => { event.stopPropagation(); onChangeModel?.() }}
            className="font-mono text-[10px] px-1.5 py-0.5 bg-kumo-fill rounded text-kumo-subtle hover:bg-kumo-fill-hover hover:text-kumo-default transition-colors"
            title="Click to change model"
          >
            {agent.model}
          </button>
        )}
      </td>
      <td className="px-3 py-2">
        <span className={`font-mono text-[11px] ${isStale ? 'text-kumo-danger font-medium' : 'text-kumo-subtle'}`}>
          {agent.lastActivityAt}
        </span>
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1">
          <RowActions
            agent={agent}
            onApprove={onApprove}
            onReply={onReply}
            onStop={onStop}
            onOpen={onOpen}
            onRemove={onRemove}
          />
          <button
            onClick={(event) => { event.stopPropagation(); onContextMenu(event) }}
            className="w-6 h-6 flex items-center justify-center rounded text-kumo-subtle hover:text-kumo-default hover:bg-kumo-fill transition-colors"
            title="Agent actions"
          >
            <GearSix size={13} />
          </button>
        </div>
      </td>
    </tr>
  )
}

function RowActions({
  agent,
  onApprove,
  onReply,
  onStop,
  onOpen,
  onRemove
}: {
  agent: AgentRuntime
  onApprove?: () => void
  onReply?: () => void
  onStop?: () => void
  onOpen?: () => void
  onRemove?: () => void
}) {
  const buttonBase = 'w-6 h-6 flex items-center justify-center bg-kumo-fill border border-kumo-line rounded text-kumo-subtle hover:bg-kumo-fill-hover hover:text-kumo-default transition-colors'
  const destructiveButton = 'w-6 h-6 flex items-center justify-center bg-kumo-danger/10 border border-kumo-danger/20 rounded text-kumo-danger hover:bg-kumo-danger/20 transition-colors'

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
      {(agent.status === 'running' || agent.status === 'needs_input' || agent.status === 'needs_approval' || agent.status === 'stopping') && (
        <button
          className={`${buttonBase} ${agent.status === 'stopping' ? 'opacity-50 cursor-not-allowed' : ''}`}
          title={agent.status === 'stopping' ? 'Stopping…' : 'Stop'}
          disabled={agent.status === 'stopping'}
          onClick={(event) => { event.stopPropagation(); onStop?.() }}
        >
          <Square size={12} weight="fill" />
        </button>
      )}
      <button
        className={destructiveButton}
        title="Remove"
        onClick={(event) => { event.stopPropagation(); onRemove?.() }}
      >
        <Trash size={12} />
      </button>
    </div>
  )
}
