import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import {
  ArrowRight,
  CaretLeft,
  CaretRight,
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
  ArrowSquareOut,
  Link,
  ArrowLineUpRight
} from '@phosphor-icons/react'
import type { AgentRuntime, LabelDefinition, LabelColorKey, ColumnKey, ColumnWidths, SortDirection } from '../types'
import { formatBranchLabel, isUrgent, labelSortKey, compareStatusPriority, ALL_COLUMNS } from '../types'
import { StatusBadge } from './StatusBadge'
import { LabelDropdown } from './LabelDropdown'
import { TextInputModal } from './TextInputModal'
import { Tooltip } from './Tooltip'
import { PrTooltipContent } from './PrTooltip'
import { useDismiss } from '../hooks/useDismiss'

interface FleetTableProps {
  agents: AgentRuntime[]
  selectedId: string | null
  onSelect: (id: string) => void
  sortColumn?: ColumnKey | null
  sortDirection?: SortDirection
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
  onSetPrUrl?: (agentId: string, prUrl: string | null) => void
  onChangeModel?: (agentId: string) => void
  onToggleLabel?: (agentId: string, labelId: string) => void
  onClearLabels?: (agentId: string) => void
  onReplaceLabel?: (agentId: string, oldLabelId: string, newLabelId: string) => void
  allLabels?: LabelDefinition[]
  onCreateLabel?: (name: string, colorKey: LabelColorKey) => Promise<LabelDefinition | null>
  onDeleteLabel?: (id: string) => Promise<boolean>
  visibleColumns: Set<ColumnKey>
  columnWidths: ColumnWidths
  onColumnResize?: (key: ColumnKey, width: number) => void
  onColumnResetWidth?: (key: ColumnKey) => void
}

const SCROLL_STEP = 200

interface ContextMenuState {
  agentId: string
  posX: number
  posY: number
}

interface RenameState {
  agentId: string
  currentName: string
}

interface PrLinkState {
  agentId: string
  currentUrl: string
}

export function FleetTable({
  agents,
  selectedId,
  onSelect,
  sortColumn: sortColumnProp,
  sortDirection: sortDirectionProp = 'asc',
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
  onSetPrUrl,
  onChangeModel,
  onToggleLabel,
  onClearLabels,
  onReplaceLabel,
  allLabels = [],
  onCreateLabel,
  onDeleteLabel,
  visibleColumns,
  columnWidths,
  onColumnResize,
  onColumnResetWidth
}: FleetTableProps) {
  const [sortColumnLocal, setSortColumnLocal] = useState<ColumnKey | null>(null)
  const [sortDirectionLocal, setSortDirectionLocal] = useState<SortDirection>('asc')
  const sortColumn = sortColumnProp !== undefined ? sortColumnProp : sortColumnLocal
  const sortDirection = sortDirectionProp !== undefined ? sortDirectionProp : sortDirectionLocal
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [renameState, setRenameState] = useState<RenameState | null>(null)
  const [prLinkState, setPrLinkState] = useState<PrLinkState | null>(null)
  const [inlineEditId, setInlineEditId] = useState<string | null>(null)
  const [labelDropdownOpen, setLabelDropdownOpen] = useState(false)
  const frozenOrderRef = useRef<string[] | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const tableRef = useRef<HTMLTableElement>(null)

  const activeColumns = useMemo(() => {
    const cols = ALL_COLUMNS.filter((col) => visibleColumns.has(col.key))
    const flexCols = cols.filter((col) => columnWidths[col.key] == null)
    const totalFlex = flexCols.reduce((sum, col) => sum + col.flex, 0)

    return cols.map((col) => {
      const customPx = columnWidths[col.key]
      const width = customPx != null
        ? `${customPx}px`
        : `${((col.flex / totalFlex) * 100).toFixed(1)}%`
      return { ...col, width }
    })
  }, [visibleColumns, columnWidths])

  // ── Column resize via drag ──
  const resizeState = useRef<{
    key: ColumnKey
    startX: number
    startWidth: number
  } | null>(null)

  const handleResizeStart = useCallback((event: React.MouseEvent, colKey: ColumnKey, colIndex: number) => {
    event.preventDefault()
    event.stopPropagation()

    const thElements = tableRef.current?.querySelectorAll('thead th')
    if (!thElements || !thElements[colIndex]) return
    const startWidth = (thElements[colIndex] as HTMLElement).getBoundingClientRect().width

    resizeState.current = { key: colKey, startX: event.clientX, startWidth }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const handleMouseMove = (moveEvent: MouseEvent): void => {
      if (!resizeState.current) return
      const delta = moveEvent.clientX - resizeState.current.startX
      const newWidth = Math.max(60, resizeState.current.startWidth + delta)
      onColumnResize?.(resizeState.current.key, Math.round(newWidth))
    }

    const handleMouseUp = (): void => {
      resizeState.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [onColumnResize])

  const handleResizeDoubleClick = useCallback((event: React.MouseEvent, colKey: ColumnKey) => {
    event.preventDefault()
    event.stopPropagation()
    onColumnResetWidth?.(colKey)
  }, [onColumnResetWidth])

  const handleSort = useCallback((column: ColumnKey) => {
    let nextDirection: SortDirection = 'asc'
    if (sortColumn === column) {
      nextDirection = sortDirection === 'asc' ? 'desc' : 'asc'
    }
    setSortColumnLocal(column)
    setSortDirectionLocal(nextDirection)
    onSort?.(column, nextDirection)
  }, [sortColumn, sortDirection, onSort])

  const handleContextMenu = useCallback((event: React.MouseEvent, agentId: string) => {
    event.preventDefault()
    setContextMenu({ agentId, posX: event.clientX, posY: event.clientY })
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  const updateScrollIndicators = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 0)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }, [])

  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    updateScrollIndicators()
    el.addEventListener('scroll', updateScrollIndicators, { passive: true })
    const observer = new ResizeObserver(updateScrollIndicators)
    observer.observe(el)
    return () => {
      el.removeEventListener('scroll', updateScrollIndicators)
      observer.disconnect()
    }
  }, [updateScrollIndicators])

  const scrollBy = useCallback((delta: number) => {
    scrollContainerRef.current?.scrollBy({ left: delta, behavior: 'smooth' })
  }, [])

  const sortedAgents = useMemo(() => {
    // While a label dropdown is open, preserve the frozen row order
    // so toggling labels doesn't cause the row to jump mid-interaction
    if (labelDropdownOpen && frozenOrderRef.current) {
      const agentMap = new Map(agents.map((a) => [a.id, a]))
      return frozenOrderRef.current
        .map((id) => agentMap.get(id))
        .filter((a): a is AgentRuntime => a !== undefined)
    }

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
        case 'label':
          leftVal = labelSortKey(left.labelIds, allLabels)
          rightVal = labelSortKey(right.labelIds, allLabels)
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
        case 'lastMessage':
          leftVal = (left.lastMessage || '').toLowerCase()
          rightVal = (right.lastMessage || '').toLowerCase()
          break
        default:
          return 0
      }

      if (leftVal < rightVal) return sortDirection === 'asc' ? -1 : 1
      if (leftVal > rightVal) return sortDirection === 'asc' ? 1 : -1
      // Tie-breaker: sort by status priority (running before idle, etc.)
      return compareStatusPriority(left.status, right.status)
    })

    return sorted
  }, [agents, sortColumn, sortDirection, allLabels, labelDropdownOpen])

  const sortedAgentsRef = useRef(sortedAgents)
  sortedAgentsRef.current = sortedAgents

  const handleLabelDropdownChange = useCallback((open: boolean) => {
    if (open) {
      frozenOrderRef.current = sortedAgentsRef.current.map((a) => a.id)
    }
    setLabelDropdownOpen(open)
  }, [])

  const headerCellClass = 'relative px-3 py-2 text-left font-medium text-[11px] uppercase tracking-wide text-kumo-subtle bg-kumo-overlay border-b border-kumo-line cursor-pointer hover:text-kumo-default select-none'

  const renderSortIndicator = (column: ColumnKey) => {
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
    <div className="flex-1 relative overflow-hidden flex flex-col" onClick={closeContextMenu}>
      <div ref={scrollContainerRef} className="flex-1 overflow-auto">
        <table ref={tableRef} className="w-full border-collapse text-xs" style={{ tableLayout: 'fixed', minWidth: 800 }}>
          <colgroup>
            {activeColumns.map((col) => (
              <col key={col.key} style={{ width: col.width }} />
            ))}
            <col style={{ width: 140 }} />
            <col style={{ width: 40 }} />
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr>
              {activeColumns.map((col, index) => (
                <th
                  key={col.key}
                  className={headerCellClass}
                  onClick={() => handleSort(col.key)}
                >
                  {col.label}
                  {renderSortIndicator(col.key)}
                  <div
                    className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-kumo-interact/30 active:bg-kumo-interact/50 transition-colors z-10"
                    onMouseDown={(event) => handleResizeStart(event, col.key, index)}
                    onDoubleClick={(event) => handleResizeDoubleClick(event, col.key)}
                    onClick={(event) => event.stopPropagation()}
                  />
                </th>
              ))}
              <th className="px-3 py-2 bg-kumo-overlay border-b border-kumo-line" />
              <th className="p-0 bg-kumo-overlay border-b border-kumo-line border-l" />
            </tr>
          </thead>
          <tbody>
            {sortedAgents.map((agent) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                selected={agent.id === selectedId}
                visibleColumns={visibleColumns}
                onSelect={() => onSelect(agent.id)}
                onContextMenu={(event) => handleContextMenu(event, agent.id)}
                onApprove={onApprove ? () => onApprove(agent.id) : undefined}
                onReply={onReply ? () => onReply(agent.id) : undefined}
                onStop={onStop ? () => onStop(agent.id) : undefined}
                onOpen={onOpen ? () => onOpen(agent.id) : () => onSelect(agent.id)}
                onRemove={onRemove ? () => onRemove(agent.id) : undefined}
                onChangeModel={onChangeModel ? () => onChangeModel(agent.id) : undefined}
                onToggleLabel={onToggleLabel ? (labelId: string) => onToggleLabel(agent.id, labelId) : undefined}
                onClearLabels={onClearLabels ? () => onClearLabels(agent.id) : undefined}
                onReplaceLabel={onReplaceLabel ? (oldId: string, newId: string) => onReplaceLabel(agent.id, oldId, newId) : undefined}
                allLabels={allLabels}
                onCreateLabel={onCreateLabel}
                onDeleteLabel={onDeleteLabel}
                onEditPrLink={() => setPrLinkState({ agentId: agent.id, currentUrl: agent.prUrl ?? '' })}
                onRemovePrLink={onSetPrUrl ? () => onSetPrUrl(agent.id, null) : undefined}
                onOpenTerminal={onOpenTerminal ? () => onOpenTerminal(agent.id) : undefined}
                onOpenInEditor={onOpenInEditor ? () => onOpenInEditor(agent.id) : undefined}
                isInlineEditing={inlineEditId === agent.id}
                onStartInlineEdit={() => setInlineEditId(agent.id)}
                onInlineRename={(newName) => {
                  onRename?.(agent.id, newName)
                  setInlineEditId(null)
                }}
                onCancelInlineEdit={() => setInlineEditId(null)}
                onLabelDropdownChange={handleLabelDropdownChange}
              />
            ))}
          </tbody>
        </table>
      </div>

      {canScrollLeft && (
        <ScrollArrow direction="left" onClick={() => scrollBy(-SCROLL_STEP)} />
      )}
      {canScrollRight && (
        <ScrollArrow direction="right" onClick={() => scrollBy(SCROLL_STEP)} />
      )}

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
          onRemovePrLink={() => {
            onSetPrUrl?.(contextMenu.agentId, null)
            closeContextMenu()
          }}
          onEditPrLink={() => {
            const agent = agents.find((agnt) => agnt.id === contextMenu.agentId)
            setPrLinkState({ agentId: contextMenu.agentId, currentUrl: agent?.prUrl ?? '' })
            closeContextMenu()
          }}
          onToggleLabel={(labelId: string) => {
            onToggleLabel?.(contextMenu.agentId, labelId)
          }}
          onClearLabels={() => {
            onClearLabels?.(contextMenu.agentId)
            closeContextMenu()
          }}
          allLabels={allLabels}
          onCreateLabel={onCreateLabel}
          onDeleteLabel={onDeleteLabel}
          onLabelDropdownChange={handleLabelDropdownChange}
        />
      )}

      {renameState && (
        <TextInputModal
          title="Rename Agent"
          initialValue={renameState.currentName}
          submitLabel="Rename"
          onSubmit={(newName) => {
            onRename?.(renameState.agentId, newName)
            setRenameState(null)
          }}
          onClose={() => setRenameState(null)}
        />
      )}

      {prLinkState && (
        <TextInputModal
          title={prLinkState.currentUrl ? 'Edit PR Link' : 'Add PR Link'}
          initialValue={prLinkState.currentUrl}
          submitLabel="Save"
          placeholder="https://github.com/org/repo/pull/123"
          allowEmpty
          onSubmit={(url) => {
            onSetPrUrl?.(prLinkState.agentId, url || null)
            setPrLinkState(null)
          }}
          onClose={() => setPrLinkState(null)}
        />
      )}
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
  onCreatePr,
  onRemovePrLink,
  onEditPrLink,
  onToggleLabel,
  onClearLabels,
  allLabels,
  onCreateLabel,
  onDeleteLabel,
  onLabelDropdownChange
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
  onRemovePrLink: () => void
  onEditPrLink: () => void
  onToggleLabel: (labelId: string) => void
  onClearLabels: () => void
  allLabels: LabelDefinition[]
  onCreateLabel?: (name: string, colorKey: LabelColorKey) => Promise<LabelDefinition | null>
  onDeleteLabel?: (id: string) => Promise<boolean>
  onLabelDropdownChange?: (open: boolean) => void
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
          <Square size={13} weight="fill" /> {isStopping ? 'Stopping...' : 'Stop'}
        </button>
      )}
      {agent.prUrl && (
        <button className={itemClass} onClick={() => window.api?.openExternal(agent.prUrl!)}>
          <ArrowLineUpRight size={13} /> View PR
        </button>
      )}
      <button className={itemClass} onClick={onEditPrLink}>
        <Link size={13} /> {agent.prUrl ? 'Edit' : 'Add'} PR Link
      </button>
      {agent.prUrl && (
        <button className={itemClass} onClick={onRemovePrLink}>
          <Trash size={13} /> Remove PR Link
        </button>
      )}
      <button className={itemClass} onClick={onCreatePr}>
        <GitPullRequest size={13} /> Create PR
      </button>
      <div className="px-2.5 py-1.5">
        <div className="text-[10px] text-kumo-subtle uppercase tracking-wide mb-1">Label</div>
        <LabelDropdown
          current={agent.labelIds}
          onToggle={onToggleLabel}
          onClear={onClearLabels}
          allLabels={allLabels}
          onCreateLabel={onCreateLabel}
          onDeleteLabel={onDeleteLabel}
          variant="action"
          onOpenChange={onLabelDropdownChange}
        />
      </div>

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
  visibleColumns,
  onSelect,
  onContextMenu,
  onApprove,
  onReply,
  onStop,
  onOpen,
  onRemove,
  onChangeModel,
  onToggleLabel,
  onClearLabels,
  onReplaceLabel,
  allLabels = [],
  onCreateLabel,
  onDeleteLabel,
  onEditPrLink,
  onRemovePrLink,
  onOpenTerminal,
  onOpenInEditor,
  isInlineEditing,
  onStartInlineEdit,
  onInlineRename,
  onCancelInlineEdit,
  onLabelDropdownChange
}: {
  agent: AgentRuntime
  selected: boolean
  visibleColumns: Set<ColumnKey>
  onSelect: () => void
  onContextMenu: (event: React.MouseEvent) => void
  onApprove?: () => void
  onReply?: () => void
  onStop?: () => void
  onOpen?: () => void
  onRemove?: () => void
  onChangeModel?: () => void
  onToggleLabel?: (labelId: string) => void
  onClearLabels?: () => void
  onReplaceLabel?: (oldLabelId: string, newLabelId: string) => void
  allLabels?: LabelDefinition[]
  onCreateLabel?: (name: string, colorKey: LabelColorKey) => Promise<LabelDefinition | null>
  onDeleteLabel?: (id: string) => Promise<boolean>
  onEditPrLink?: () => void
  onRemovePrLink?: () => void
  onOpenTerminal?: () => void
  onOpenInEditor?: () => void
  isInlineEditing: boolean
  onStartInlineEdit: () => void
  onInlineRename: (newName: string) => void
  onCancelInlineEdit: () => void
  onLabelDropdownChange?: (open: boolean) => void
}) {
  const urgent = isUrgent(agent)
  const isStale = !!agent.blockedSince
  const [inlineValue, setInlineValue] = useState(agent.name)
  const inlineInputRef = useRef<HTMLInputElement>(null)
  const inlineSubmittedRef = useRef(false)
  const arrowMenu = useDismiss<HTMLTableCellElement>()

  useEffect(() => {
    if (!isInlineEditing) return
    inlineSubmittedRef.current = false
    setInlineValue(agent.name)
    requestAnimationFrame(() => {
      inlineInputRef.current?.focus()
      inlineInputRef.current?.select()
    })
  }, [isInlineEditing, agent.name])

  const handleInlineSubmit = () => {
    if (inlineSubmittedRef.current) return
    inlineSubmittedRef.current = true
    const trimmed = inlineValue.trim()
    if (trimmed && trimmed !== agent.name) {
      onInlineRename(trimmed)
    } else {
      onCancelInlineEdit()
    }
  }

  const handleInlineKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      handleInlineSubmit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onCancelInlineEdit()
    }
  }

  const show = (key: ColumnKey): boolean => visibleColumns.has(key)

  return (
    <tr
      onClick={onSelect}
      onContextMenu={onContextMenu}
      className={`group cursor-default transition-colors border-b border-kumo-line ${
        selected
          ? 'bg-kumo-control'
          : urgent
            ? 'bg-kumo-danger/[0.04] hover:bg-kumo-danger/[0.08]'
            : 'hover:bg-kumo-control'
      }`}
    >
      {show('agent') && (
        <td className="px-3 py-2 overflow-hidden">
          {isInlineEditing ? (
            <input
              ref={inlineInputRef}
              value={inlineValue}
              onChange={(event) => setInlineValue(event.target.value)}
              onKeyDown={handleInlineKeyDown}
              onBlur={handleInlineSubmit}
              onClick={(event) => event.stopPropagation()}
              className="font-semibold text-kumo-strong bg-kumo-control border border-kumo-ring rounded px-1.5 py-0.5 text-xs outline-none w-full max-w-[200px]"
            />
          ) : (
            <div
              onClick={(event) => { event.stopPropagation(); onStartInlineEdit() }}
              className="font-semibold text-kumo-strong rounded px-1.5 py-0.5 -mx-1.5 -my-0.5 cursor-text outline outline-1 outline-transparent hover:outline-kumo-subtle/40 transition-[outline-color] truncate"
              title={agent.name}
            >
              {agent.name}
            </div>
          )}
          <span className="truncate">{agent.projectName}</span>
        </td>
      )}
      {show('status') && (
        <td className="px-3 py-2 overflow-hidden">
          <div className="flex flex-col gap-0.5">
            <StatusBadge status={agent.status} />
            <span className={`font-mono text-[10px] ${isStale ? 'text-kumo-danger font-medium' : 'text-kumo-subtle'}`}>
              {agent.lastActivityAt}
            </span>
          </div>
        </td>
      )}
      {show('label') && (
        <td className="px-3 py-2">
          {onToggleLabel && onClearLabels && (
            <LabelDropdown
              current={agent.labelIds}
              onToggle={onToggleLabel}
              onClear={onClearLabels}
              onReplace={onReplaceLabel}
              allLabels={allLabels}
              onCreateLabel={onCreateLabel}
              onDeleteLabel={onDeleteLabel}
              variant="inline"
              onOpenChange={onLabelDropdownChange}
            />
          )}
        </td>
      )}
      {show('task') && (
        <td className="px-3 py-2 truncate text-kumo-default" title={agent.taskSummary || undefined}>
          {agent.taskSummary}
        </td>
      )}
      {show('lastMessage') && (
        <td className="px-3 py-2 truncate text-kumo-subtle text-[11px]" title={agent.lastMessage || undefined}>
          {agent.lastMessage || <span className="text-kumo-muted italic">--</span>}
        </td>
      )}
      {show('branch') && (
        <td className="px-3 py-2 font-mono text-[11px] text-kumo-subtle truncate" title={formatBranchLabel(agent)}>
          {formatBranchLabel(agent)}
        </td>
      )}
      {show('model') && (
        <td className="px-3 py-2 overflow-hidden">
          {agent.model && agent.model !== 'starting...' && (
            <button
              onClick={(event) => { event.stopPropagation(); onChangeModel?.() }}
              className="font-mono text-[10px] px-1.5 py-0.5 bg-kumo-fill rounded text-kumo-subtle hover:bg-kumo-fill-hover hover:text-kumo-default transition-colors max-w-full truncate block cursor-pointer"
              title={agent.model}
            >
              {agent.model}
            </button>
          )}
        </td>
      )}
      <td className="px-3 py-2 overflow-hidden">
        <div className="flex items-center justify-end gap-1">
          <RowActions
            agent={agent}
            onApprove={onApprove}
            onReply={onReply}
            onStop={onStop}
            onRemove={onRemove}
          />
          {agent.prUrl ? (
            <Tooltip
              content={
                <PrTooltipContent
                  url={agent.prUrl}
                  actions={{
                    onOpen: () => window.api?.openExternal(agent.prUrl!),
                    onEdit: onEditPrLink,
                    onRemove: onRemovePrLink,
                  }}
                />
              }
              position="top"
              interactive
            >
              <button
                onClick={(event) => { event.stopPropagation(); window.api?.openExternal(agent.prUrl!) }}
                className="w-6 h-6 flex items-center justify-center rounded text-kumo-brand hover:bg-kumo-brand/20 transition-colors cursor-pointer"
              >
                <GitPullRequest size={13} weight="bold" />
              </button>
            </Tooltip>
          ) : (
            <button
              onClick={(event) => { event.stopPropagation(); onEditPrLink?.() }}
              className="w-6 h-6 flex items-center justify-center rounded text-kumo-subtle/40 hover:text-kumo-subtle hover:bg-kumo-fill transition-colors cursor-pointer"
              title="Add PR link"
            >
              <GitPullRequest size={13} />
            </button>
          )}
          <button
            onClick={(event) => { event.stopPropagation(); onContextMenu(event) }}
            className="w-6 h-6 flex items-center justify-center rounded text-kumo-subtle hover:text-kumo-default hover:bg-kumo-fill transition-colors cursor-pointer"
            title="Agent actions"
          >
            <GearSix size={13} />
          </button>
        </div>
      </td>
      <td
        ref={arrowMenu.containerRef}
        className="p-0 border-l border-kumo-line bg-kumo-fill/50 cursor-pointer hover:bg-kumo-fill transition-colors relative"
        onClick={(event) => { event.stopPropagation(); arrowMenu.toggle() }}
      >
        <div className="w-full flex items-center justify-center py-2 text-kumo-subtle group-hover:text-kumo-default">
          <ArrowRight size={14} weight="bold" />
        </div>
        {arrowMenu.open && (
          <ArrowMenuPopover
            onOpen={() => { arrowMenu.close(); onOpen?.() }}
            onOpenTerminal={() => { arrowMenu.close(); onOpenTerminal?.() }}
            onOpenInEditor={() => { arrowMenu.close(); onOpenInEditor?.() }}
          />
        )}
      </td>
    </tr>
  )
}

function RowActions({
  agent,
  onApprove,
  onReply,
  onStop,
  onRemove
}: {
  agent: AgentRuntime
  onApprove?: () => void
  onReply?: () => void
  onStop?: () => void
  onRemove?: () => void
}) {
  const buttonBase = 'w-6 h-6 flex items-center justify-center bg-kumo-fill border border-kumo-line rounded text-kumo-subtle hover:bg-kumo-fill-hover hover:text-kumo-default transition-colors cursor-pointer'
  const destructiveButton = 'w-6 h-6 flex items-center justify-center bg-kumo-danger/10 border border-kumo-danger/20 rounded text-kumo-danger hover:bg-kumo-danger/20 transition-colors cursor-pointer'
  const isStoppable = agent.status === 'running' || agent.status === 'needs_input' || agent.status === 'needs_approval' || agent.status === 'stopping'
  const isStopping = agent.status === 'stopping'

  // Context action slot — mutually exclusive statuses, always reserves space
  let contextAction: { title: string; icon: React.ReactNode; handler?: () => void } | null = null
  if (agent.status === 'needs_approval') {
    contextAction = { title: 'Approve', icon: <Check size={12} weight="bold" />, handler: onApprove }
  } else if (agent.status === 'needs_input') {
    contextAction = { title: 'Reply', icon: <PencilSimple size={12} weight="bold" />, handler: onReply }
  } else if (agent.status === 'running') {
    contextAction = { title: 'Pause', icon: <Pause size={12} weight="bold" />, handler: onStop }
  }

  return (
    <div className="flex gap-1 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity">
      <button
        className={`${buttonBase} ${contextAction ? '' : 'invisible'}`}
        title={contextAction?.title}
        onClick={(event) => { event.stopPropagation(); contextAction?.handler?.() }}
      >
        {contextAction?.icon ?? <Pause size={12} weight="bold" />}
      </button>
      <button
        className={`${buttonBase} ${isStoppable ? '' : 'invisible'} ${isStopping ? 'opacity-50 cursor-not-allowed' : ''}`}
        title={isStopping ? 'Stopping...' : 'Stop'}
        disabled={!isStoppable || isStopping}
        onClick={(event) => { event.stopPropagation(); onStop?.() }}
      >
        <Square size={12} weight="fill" />
      </button>
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

function ScrollArrow({ direction, onClick }: { direction: 'left' | 'right'; onClick: () => void }) {
  const isLeft = direction === 'left'
  const Icon = isLeft ? CaretLeft : CaretRight
  return (
    <button
      onClick={onClick}
      className={`absolute ${isLeft ? 'left-0 rounded-r-lg' : 'right-0 rounded-l-lg'} top-1/2 -translate-y-1/2 z-20 w-7 h-12 flex items-center justify-center bg-kumo-overlay/90 border border-kumo-line shadow-lg text-kumo-subtle hover:text-kumo-default hover:bg-kumo-elevated transition-colors cursor-pointer`}
      aria-label={`Scroll ${direction}`}
    >
      <Icon size={14} weight="bold" />
    </button>
  )
}

const arrowMenuItemClass = 'flex items-center gap-2 w-full px-2.5 py-1.5 text-[11px] text-kumo-default rounded hover:bg-kumo-fill transition-colors text-left'

function ArrowMenuPopover({
  onOpen,
  onOpenTerminal,
  onOpenInEditor
}: {
  onOpen: () => void
  onOpenTerminal: () => void
  onOpenInEditor: () => void
}) {
  return (
    <div className="absolute right-0 top-full mt-1 z-[100] min-w-[160px] rounded-lg border border-kumo-line bg-kumo-elevated p-1 shadow-xl">
      <button
        className={arrowMenuItemClass}
        onClick={(event) => { event.stopPropagation(); onOpen() }}
      >
        <ArrowRight size={13} /> Open Drawer
      </button>
      <button
        className={arrowMenuItemClass}
        onClick={(event) => { event.stopPropagation(); onOpenTerminal() }}
      >
        <Terminal size={13} /> Terminal
      </button>
      <button
        className={arrowMenuItemClass}
        onClick={(event) => { event.stopPropagation(); onOpenInEditor() }}
      >
        <ArrowSquareOut size={13} /> Editor
      </button>
    </div>
  )
}
