import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import {
  ArrowRight,
  CaretLeft,
  CaretRight,
  CaretUp,
  CaretDown,
  Check,
  DotsSixVertical,
  FolderSimple,
  FolderSimplePlus,
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
  ArrowLineUpRight,
  WarningCircle
} from '@phosphor-icons/react'
import type { AgentRuntime, AgentFolder, LabelDefinition, LabelColorKey, ColumnKey, ColumnWidths, SortDirection } from '../types'
import { formatBranchLabel, isUrgent, labelSortKey, compareStatusPriority, ALL_COLUMNS } from '../types'
import { isRecentlyAttached } from '../hooks/useAgentStore'
import { StatusBadge } from './StatusBadge'
import { LabelDropdown } from './LabelDropdown'
import { PortaledMenu } from './PortaledMenu'
import { TextInputModal } from './TextInputModal'
import { Tooltip } from './Tooltip'
import { PrTooltipContent } from './PrTooltip'
import { ContextUsageIndicator } from './ContextUsageIndicator'

/**
 * Return the agent's context-window fill fraction (0–1) or -1 when we don't
 * have enough data. Used to sort rows by how close they are to overflow;
 * agents without metrics sink to the bottom in ascending sorts.
 */
function contextFraction(agent: AgentRuntime): number {
  const { contextTokens, contextLimit } = agent
  if (typeof contextTokens !== 'number' || typeof contextLimit !== 'number' || contextLimit <= 0) {
    return -1
  }
  return contextTokens / contextLimit
}
import { useDismiss } from '../hooks/useDismiss'
import {
  Lightning,
  Rocket,
  Code,
  CheckCircle,
  PaperPlaneTilt,
  Wrench,
} from '@phosphor-icons/react'
import { loadSettings, SETTINGS_CHANGED_EVENT, isQuickActionValid, type QuickAction, type QuickActionIcon } from '../data/settings'
import { useEditorLabel } from '../hooks/useEditorLabel'

const quickActionIconMap: Record<QuickActionIcon, typeof Lightning> = {
  'git-pull-request': GitPullRequest,
  'rocket': Rocket,
  'lightning': Lightning,
  'terminal': Terminal,
  'code': Code,
  'check-circle': CheckCircle,
  'paper-plane': PaperPlaneTilt,
  'wrench': Wrench,
}

/**
 * Where to land in the transcript when opening the drawer.
 *  - 'last-user-message': scroll the last user message to the top of the
 *    viewport. Used when jumping back from a notification or quick-action.
 *  - 'bottom': scroll all the way to the bottom and re-engage follow-mode
 *    so the next streaming reply auto-scrolls into view. Used after sending
 *    from the workspace's highlight-to-ask popover.
 */
export type DrawerScrollTarget = 'last-user-message' | 'bottom'

interface FleetTableProps {
  agents: AgentRuntime[]
  selectedId: string | null
  onSelect: (id: string, scrollTarget?: DrawerScrollTarget) => void
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
  onQuickAction?: (agentId: string, action: QuickAction) => void
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

// ── Folder spike: localStorage helpers ──────────────────────────────────────
const SPIKE_FOLDERS_KEY = 'oco.spike.folders'
const SPIKE_MEMBERSHIP_KEY = 'oco.spike.folderMembership'
const SPIKE_EXPANDED_KEY = 'oco.spike.foldersExpanded'

function readJson<T>(key: string, fallback: T, validate: (value: unknown) => T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return validate(JSON.parse(raw))
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* noop — quota exceeded or storage unavailable */
  }
}

function loadSpikeFolders(): AgentFolder[] {
  return readJson(SPIKE_FOLDERS_KEY, [] as AgentFolder[], (value) => {
    if (!Array.isArray(value)) return []
    return value.filter((f): f is AgentFolder => typeof f?.id === 'string' && typeof f?.name === 'string')
  })
}

function saveSpikeFolders(folders: AgentFolder[]) {
  writeJson(SPIKE_FOLDERS_KEY, folders)
}

function loadSpikeMembership(): Record<string, string> {
  return readJson(SPIKE_MEMBERSHIP_KEY, {} as Record<string, string>, (value) => {
    if (!value || typeof value !== 'object') return {}
    return value as Record<string, string>
  })
}

function saveSpikeMembership(map: Record<string, string>) {
  writeJson(SPIKE_MEMBERSHIP_KEY, map)
}

function loadSpikeExpanded(): Set<string> {
  return readJson(SPIKE_EXPANDED_KEY, new Set<string>(), (value) => {
    return new Set(Array.isArray(value) ? value : [])
  })
}

function saveSpikeExpanded(set: Set<string>) {
  writeJson(SPIKE_EXPANDED_KEY, Array.from(set))
}

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
  onQuickAction,
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
  const tableRef = useRef<HTMLTableElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  // ── Folder spike (client-side only, localStorage persistence) ─────────────
  // Folder definitions and agent→folder membership live here for the
  // prototype. Real persistence will move to the preferences table later.
  const [folders, setFolders] = useState<AgentFolder[]>(() => loadSpikeFolders())
  const [agentFolderMap, setAgentFolderMap] = useState<Record<string, string>>(() => loadSpikeMembership())
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => loadSpikeExpanded())
  const [dragAgentId, setDragAgentId] = useState<string | null>(null)
  const [dropFolderId, setDropFolderId] = useState<string | 'root' | null>(null)
  const [folderRenameId, setFolderRenameId] = useState<string | null>(null)

  useEffect(() => { saveSpikeFolders(folders) }, [folders])
  useEffect(() => { saveSpikeMembership(agentFolderMap) }, [agentFolderMap])
  useEffect(() => { saveSpikeExpanded(expandedFolders) }, [expandedFolders])

  const createFolder = useCallback(() => {
    const id = `folder-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    const sortOrder = folders.length
    setFolders((prev) => [...prev, { id, name: 'New Folder', sortOrder }])
    setExpandedFolders((prev) => new Set(prev).add(id))
    setFolderRenameId(id)
  }, [folders.length])

  const renameFolder = useCallback((id: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name: trimmed } : f)))
  }, [])

  const deleteFolder = useCallback((id: string) => {
    setFolders((prev) => prev.filter((f) => f.id !== id))
    setAgentFolderMap((prev) => {
      const next = { ...prev }
      for (const [agentId, folderId] of Object.entries(next)) {
        if (folderId === id) delete next[agentId]
      }
      return next
    })
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  const moveAgent = useCallback((agentId: string, folderId: string | null) => {
    setAgentFolderMap((prev) => {
      const next = { ...prev }
      if (folderId == null) delete next[agentId]
      else next[agentId] = folderId
      return next
    })
  }, [])

  const toggleFolderExpanded = useCallback((id: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const resetDrag = useCallback(() => {
    setDragAgentId(null)
    setDropFolderId(null)
  }, [])

  // ── Manual mouse-tracked drag system ──────────────────────────────────────
  // We abandoned HTML5 DnD because `draggable` on table rows in border-collapse
  // tables is unreliable across Chromium versions. This uses raw mouse events:
  // mousedown captures origin; once movement exceeds the threshold we commit to
  // a drag and render a floating ghost that follows the cursor. Drop targets
  // (folders, root zone) signal hover via setDropFolderId. On mouseup we read
  // the latest drop target from a ref and commit the move.
  const DRAG_THRESHOLD_PX = 4
  const dragPress = useRef<{
    agentId: string
    agentName: string
    originX: number
    originY: number
    started: boolean
  } | null>(null)
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null)
  const [ghostName, setGhostName] = useState<string>('')
  // Set when a real drag completed; used to swallow the trailing click so the
  // drawer doesn't open on drop.
  const suppressNextClick = useRef(false)
  // Mirror of dropFolderId for closure-safe reads inside the global mouseup
  // handler (which captures state at effect setup time).
  const dropFolderIdRef = useRef<string | 'root' | null>(null)
  useEffect(() => { dropFolderIdRef.current = dropFolderId }, [dropFolderId])

  const beginAgentDragPress = useCallback((agentId: string, agentName: string, e: React.MouseEvent) => {
    if (e.button !== 0) return
    // Skip if the press lands on an inner control.
    const target = e.target as HTMLElement
    if (target.closest('input, textarea, select, button, [contenteditable="true"], [role="menu"], [role="combobox"]')) {
      return
    }
    dragPress.current = {
      agentId,
      agentName,
      originX: e.clientX,
      originY: e.clientY,
      started: false,
    }
  }, [])

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      const press = dragPress.current
      if (!press) return
      if (!press.started) {
        const dx = Math.abs(e.clientX - press.originX)
        const dy = Math.abs(e.clientY - press.originY)
        if (dx < DRAG_THRESHOLD_PX && dy < DRAG_THRESHOLD_PX) return
        // Commit to drag: prevent text selection, set state, switch cursor.
        press.started = true
        setDragAgentId(press.agentId)
        setGhostName(press.agentName)
        document.body.style.userSelect = 'none'
        document.body.style.cursor = 'grabbing'
      }
      setGhostPos({ x: e.clientX, y: e.clientY })
    }

    const handleUp = () => {
      const press = dragPress.current
      if (!press) return
      const wasDragging = press.started
      const agentId = press.agentId
      dragPress.current = null
      if (!wasDragging) return

      const dropTarget = dropFolderIdRef.current
      if (dropTarget === 'root') {
        moveAgent(agentId, null)
      } else if (dropTarget != null) {
        moveAgent(agentId, dropTarget)
      }

      resetDrag()
      setGhostPos(null)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      suppressNextClick.current = true
      // Clear the suppress flag after the trailing click has had a chance to fire.
      setTimeout(() => { suppressNextClick.current = false }, 0)
    }

    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
    return () => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
    }
  }, [moveAgent, resetDrag])

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
        case 'context': {
          // Sort by usage fraction so the agents closest to overflow surface
          // at one end of the sorted list. Rows with no usage data sort last.
          const leftPct = contextFraction(left)
          const rightPct = contextFraction(right)
          if (leftPct === rightPct) return compareStatusPriority(left.status, right.status)
          return sortDirection === 'asc' ? leftPct - rightPct : rightPct - leftPct
        }
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

  // ── Folder tree assembly ──────────────────────────────────────────────────
  // Group sortedAgents by their folder membership. Folder ordering follows
  // each folder's sortOrder. Within a folder, agents already arrive sorted
  // from the sort pass above, so we just partition them.
  const grouped = useMemo(() => {
    const byFolder = new Map<string, AgentRuntime[]>()
    const rootAgents: AgentRuntime[] = []
    for (const agent of sortedAgents) {
      const folderId = agentFolderMap[agent.id]
      if (folderId && folders.some((f) => f.id === folderId)) {
        const list = byFolder.get(folderId) ?? []
        list.push(agent)
        byFolder.set(folderId, list)
      } else {
        rootAgents.push(agent)
      }
    }
    const orderedFolders = [...folders].sort((a, b) => a.sortOrder - b.sortOrder)
    return { byFolder, rootAgents, orderedFolders }
  }, [sortedAgents, agentFolderMap, folders])

  // Auto-expand folders that contain urgent agents (blocked/needs_input/errored).
  // Saved expansion state still applies; this is an override that keeps users
  // from missing urgent work inside a collapsed folder.
  const effectiveExpanded = useMemo(() => {
    const result = new Set(expandedFolders)
    for (const folder of grouped.orderedFolders) {
      const children = grouped.byFolder.get(folder.id) ?? []
      if (children.some((a) => isUrgent(a))) result.add(folder.id)
    }
    // Also force-expand the folder containing the currently selected agent.
    if (selectedId) {
      const selectedFolder = agentFolderMap[selectedId]
      if (selectedFolder) result.add(selectedFolder)
    }
    return result
  }, [grouped, expandedFolders, selectedId, agentFolderMap])

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

  // Render helper so we can reuse the AgentRow wiring for both root and
  // folder-nested agents. Keeps the JSX below readable.
  const renderAgentRowFn = (agent: AgentRuntime, indented: boolean) => (
    <AgentRow
      key={agent.id}
      agent={agent}
      selected={agent.id === selectedId}
      visibleColumns={visibleColumns}
      indented={indented}
      isDragging={dragAgentId === agent.id}
      isAnyDragActive={dragAgentId !== null}
      onMouseDownStartDrag={(e) => beginAgentDragPress(agent.id, agent.name, e)}
      suppressNextClickRef={suppressNextClick}
      onSelect={() => onSelect(agent.id)}
      onJumpToLastUserMessage={() => onSelect(agent.id, 'last-user-message')}
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
  )

  if (agents.length === 0 && folders.length === 0) {
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
      {/* Floating drag ghost: follows the cursor while a drag is active. */}
      {dragAgentId && ghostPos && (
        <div
          className="fixed pointer-events-none z-[1000] px-2.5 py-1 text-xs font-semibold text-white bg-kumo-brand rounded-md shadow-lg whitespace-nowrap"
          style={{ left: ghostPos.x + 12, top: ghostPos.y + 12 }}
        >
          {ghostName}
        </div>
      )}
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
            {/* Root-level "Top level" drop zone — only visible while dragging */}
            {dragAgentId && folders.length > 0 && (
              <RootDropZone
                colSpan={activeColumns.length + 2}
                isHovered={dropFolderId === 'root'}
                onMouseEnter={() => setDropFolderId('root')}
                onMouseLeave={() => setDropFolderId((cur) => (cur === 'root' ? null : cur))}
              />
            )}

            {/* Root-level agents */}
            {grouped.rootAgents.map((agent) => renderAgentRowFn(agent, /* indented */ false))}

            {/* Folder groups */}
            {grouped.orderedFolders.map((folder) => {
              const children = grouped.byFolder.get(folder.id) ?? []
              const urgentCount = children.filter((a) => isUrgent(a)).length
              const expanded = effectiveExpanded.has(folder.id)
              const isDropTarget = dropFolderId === folder.id
              return (
                <FolderRowGroup
                  key={folder.id}
                  folder={folder}
                  childCount={children.length}
                  urgentCount={urgentCount}
                  expanded={expanded}
                  isRenaming={folderRenameId === folder.id}
                  isDropTarget={isDropTarget}
                  isDraggingActive={dragAgentId !== null}
                  colSpan={activeColumns.length + 2}
                  onToggle={() => toggleFolderExpanded(folder.id)}
                  onStartRename={() => setFolderRenameId(folder.id)}
                  onRename={(name) => {
                    renameFolder(folder.id, name)
                    setFolderRenameId(null)
                  }}
                  onCancelRename={() => setFolderRenameId(null)}
                  onDelete={() => deleteFolder(folder.id)}
                  onMouseEnter={() => { if (dragAgentId) setDropFolderId(folder.id) }}
                  onMouseLeave={() => setDropFolderId((cur) => (cur === folder.id ? null : cur))}
                >
                  {expanded && children.map((agent) => renderAgentRowFn(agent, /* indented */ true))}
                </FolderRowGroup>
              )
            })}

            {/* "New Folder" button as a final row, only when not dragging */}
            {!dragAgentId && (
              <tr>
                <td colSpan={activeColumns.length + 2} className="px-3 py-2">
                  <button
                    type="button"
                    onClick={createFolder}
                    className="flex items-center gap-1.5 text-[11px] text-kumo-subtle hover:text-kumo-default px-2 py-1 rounded hover:bg-kumo-fill transition-colors cursor-pointer"
                    title="Create a new folder for grouping agents"
                  >
                    <FolderSimplePlus size={13} />
                    <span>New Folder</span>
                  </button>
                </td>
              </tr>
            )}
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
          onQuickAction={(action: QuickAction) => {
            onQuickAction?.(contextMenu.agentId, action)
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
  onQuickAction,
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
  onQuickAction: (action: QuickAction) => void
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
  const [quickActions, setQuickActions] = useState(() => loadSettings().quickActions)
  const editorLabel = useEditorLabel()

  useEffect(() => {
    const onSettingsChanged = () => setQuickActions(loadSettings().quickActions)
    window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
  }, [])

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
      {quickActions.filter((qa): qa is QuickAction => qa !== null && isQuickActionValid(qa)).map((qa) => {
        const Icon = quickActionIconMap[qa.icon] ?? Lightning
        return (
          <button key={qa.id} className={itemClass} onClick={() => onQuickAction(qa)}>
            <Icon size={13} /> {qa.label}
          </button>
        )
      })}
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
        <ArrowSquareOut size={13} /> Open in {editorLabel}
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
  indented = false,
  isDragging = false,
  isAnyDragActive = false,
  onMouseDownStartDrag,
  suppressNextClickRef,
  onSelect,
  onJumpToLastUserMessage,
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
  /** When true, the row is rendered inside a folder and indented slightly. */
  indented?: boolean
  /** True while this row is the active drag source; used to dim it. */
  isDragging?: boolean
  /** True while ANY row is being dragged. Suppresses hover styling so other
   * agent rows don't look like drop targets. */
  isAnyDragActive?: boolean
  /** Manual drag system: called on mousedown to capture origin coords. */
  onMouseDownStartDrag?: (e: React.MouseEvent) => void
  /** Set to true when a drag completed, used to swallow trailing click. */
  suppressNextClickRef?: React.MutableRefObject<boolean>
  onSelect: () => void
  onJumpToLastUserMessage: () => void
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
  const flashing = isRecentlyAttached(agent.id)
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

  // Background/hover styling depends on selection, urgency, and whether a drag
  // is in progress (during drag we suppress hover so non-folder rows don't
  // look like drop targets). Compute it as an explicit branch chain rather
  // than nesting ternaries inline.
  let rowStateClass: string
  if (selected) {
    rowStateClass = 'bg-kumo-control'
  } else if (urgent) {
    rowStateClass = isAnyDragActive
      ? 'bg-kumo-danger/[0.04]'
      : 'bg-kumo-danger/[0.04] hover:bg-kumo-danger/[0.08]'
  } else {
    rowStateClass = isAnyDragActive ? '' : 'hover:bg-kumo-control'
  }
  const flashingClass = flashing ? 'ring-2 ring-inset ring-kumo-brand/60 bg-kumo-brand/[0.06]' : ''
  const draggingClass = isDragging ? 'opacity-40' : ''

  return (
    <tr
      onMouseDown={(e) => onMouseDownStartDrag?.(e)}
      onClickCapture={(e) => {
        // Swallow the trailing click after a drag completes so the drawer
        // doesn't pop open on drop.
        if (suppressNextClickRef?.current) {
          e.preventDefault()
          e.stopPropagation()
        }
      }}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      className={`group cursor-pointer transition-colors border-b border-kumo-line ${rowStateClass} ${flashingClass} ${draggingClass}`}
    >
      {show('agent') && (
        <td className={`px-3 py-2 overflow-hidden ${indented ? 'pl-7' : ''}`}>
          <div className="flex items-start gap-1.5">
            {/* Grip is a visual affordance only — the whole row is draggable. */}
            <div
              className="text-kumo-subtle/30 group-hover:text-kumo-subtle/70 transition-colors shrink-0 -ml-1 mt-0.5 pointer-events-none"
              title="Drag to move to a folder"
            >
              <DotsSixVertical size={12} />
            </div>
            <div className="flex-1 min-w-0">
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
              <span className="truncate block">{agent.projectName}</span>
            </div>
          </div>
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
        <td className="px-3 py-2 truncate text-kumo-default">
          {agent.taskSummary && (
            <span
              className="cursor-pointer hover:text-kumo-strong"
              title={`${agent.taskSummary}\n\nClick to jump to your last message`}
              onClick={(event) => { event.stopPropagation(); onJumpToLastUserMessage() }}
            >
              {agent.taskSummary}
            </span>
          )}
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
      {show('context') && (
        <td className="px-3 py-2 overflow-hidden">
          <ContextUsageIndicator
            used={agent.contextTokens}
            limit={agent.contextLimit}
            variant="bar"
          />
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
        <ArrowMenuPopover
          open={arrowMenu.open}
          triggerRef={arrowMenu.containerRef}
          onDismiss={arrowMenu.close}
          onOpen={() => { arrowMenu.close(); onOpen?.() }}
          onOpenTerminal={() => { arrowMenu.close(); onOpenTerminal?.() }}
          onOpenInEditor={() => { arrowMenu.close(); onOpenInEditor?.() }}
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
  open,
  triggerRef,
  onDismiss,
  onOpen,
  onOpenTerminal,
  onOpenInEditor
}: {
  open: boolean
  triggerRef: React.RefObject<HTMLTableCellElement | null>
  onDismiss: () => void
  onOpen: () => void
  onOpenTerminal: () => void
  onOpenInEditor: () => void
}) {
  const editorLabel = useEditorLabel()
  return (
    <PortaledMenu
      open={open}
      triggerRef={triggerRef}
      placement="bottom-right"
      onDismiss={onDismiss}
      className="min-w-[160px] rounded-lg border border-kumo-line bg-kumo-elevated p-1 shadow-xl"
    >
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
        <ArrowSquareOut size={13} /> {editorLabel}
      </button>
    </PortaledMenu>
  )
}

/**
 * Folder header row + its (already-rendered) child agent rows. Renders as a
 * Fragment so the children remain siblings in the table body for layout. The
 * header itself spans all columns and provides expand/collapse + drop target.
 */
function FolderRowGroup({
  folder,
  childCount,
  urgentCount,
  expanded,
  isRenaming,
  isDropTarget,
  isDraggingActive,
  colSpan,
  onToggle,
  onStartRename,
  onRename,
  onCancelRename,
  onDelete,
  onMouseEnter,
  onMouseLeave,
  children,
}: {
  folder: AgentFolder
  childCount: number
  urgentCount: number
  expanded: boolean
  isRenaming: boolean
  isDropTarget: boolean
  /** True while any agent is being dragged anywhere — turns the row into a drop target. */
  isDraggingActive: boolean
  colSpan: number
  onToggle: () => void
  onStartRename: () => void
  onRename: (name: string) => void
  onCancelRename: () => void
  onDelete: () => void
  onMouseEnter: () => void
  onMouseLeave: () => void
  children: React.ReactNode
}) {
  const [draftName, setDraftName] = useState(folder.name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isRenaming) return
    setDraftName(folder.name)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [isRenaming, folder.name])

  const handleSubmit = () => {
    const trimmed = draftName.trim()
    if (trimmed && trimmed !== folder.name) onRename(trimmed)
    else onCancelRename()
  }

  let headerStateClass: string
  if (isDropTarget) {
    headerStateClass = 'bg-kumo-brand/20 ring-1 ring-inset ring-kumo-brand/60'
  } else if (isDraggingActive) {
    headerStateClass = 'bg-kumo-fill/40 hover:bg-kumo-fill/60 ring-1 ring-inset ring-kumo-brand/20'
  } else {
    headerStateClass = 'bg-kumo-fill/40 hover:bg-kumo-fill/60'
  }

  return (
    <>
      <tr
        onClick={onToggle}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        className={`group/folder transition-colors border-b border-kumo-line cursor-pointer select-none ${headerStateClass}`}
      >
        <td colSpan={colSpan} className="px-3 py-1.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onToggle() }}
              className="flex items-center gap-1.5 text-kumo-subtle hover:text-kumo-default shrink-0 cursor-pointer"
              title={expanded ? 'Collapse folder' : 'Expand folder'}
            >
              <CaretRight
                size={11}
                weight="bold"
                className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
              />
              <FolderSimple size={13} weight={expanded ? 'fill' : 'regular'} />
            </button>
            {isRenaming ? (
              <input
                ref={inputRef}
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={handleSubmit}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleSubmit()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    onCancelRename()
                  }
                }}
                className="font-semibold text-xs text-kumo-strong bg-kumo-control border border-kumo-ring rounded px-1.5 py-0.5 outline-none max-w-[200px]"
              />
            ) : (
              <span
                className="font-semibold text-xs text-kumo-strong truncate cursor-text rounded px-1.5 py-0.5 -mx-1.5 -my-0.5 outline outline-1 outline-transparent hover:outline-kumo-subtle/40 transition-[outline-color]"
                onClick={(e) => { e.stopPropagation(); onStartRename() }}
                title="Click to rename"
              >
                {folder.name}
              </span>
            )}
            {/* Spacer pushes count/badges/actions to the right edge */}
            <div className="flex-1" />
            <span className="text-[10px] text-kumo-subtle font-mono shrink-0">
              {childCount}
            </span>
            {urgentCount > 0 && (
              <span
                className="flex items-center gap-0.5 text-[10px] font-medium text-kumo-danger px-1.5 py-0.5 rounded bg-kumo-danger/10 shrink-0"
                title={`${urgentCount} agent(s) need attention`}
              >
                <WarningCircle size={10} weight="fill" />
                {urgentCount}
              </span>
            )}
            <div className="flex items-center gap-0.5 opacity-0 group-hover/folder:opacity-100 transition-opacity">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onStartRename() }}
                className="w-6 h-6 flex items-center justify-center rounded text-kumo-subtle hover:text-kumo-default hover:bg-kumo-fill transition-colors cursor-pointer"
                title="Rename folder"
              >
                <PencilSimple size={11} />
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onDelete() }}
                className="w-6 h-6 flex items-center justify-center rounded text-kumo-subtle hover:text-kumo-danger hover:bg-kumo-danger/10 transition-colors cursor-pointer"
                title="Delete folder (agents move to top level)"
              >
                <Trash size={11} />
              </button>
            </div>
          </div>
        </td>
      </tr>
      {expanded && childCount === 0 && isDraggingActive && (
        <tr
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
          className={`border-b border-kumo-line ${isDropTarget ? 'bg-kumo-brand/10' : ''}`}
        >
          <td colSpan={colSpan} className="px-3 py-2 text-center text-[11px] text-kumo-subtle italic">
            Drop here
          </td>
        </tr>
      )}
      {children}
    </>
  )
}

/**
 * Visible only while dragging — gives users an explicit "move to top level"
 * target above all folders. Renders as a full-width subtle banner.
 */
function RootDropZone({
  colSpan,
  isHovered,
  onMouseEnter,
  onMouseLeave,
}: {
  colSpan: number
  isHovered: boolean
  onMouseEnter: () => void
  onMouseLeave: () => void
}) {
  return (
    <tr
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`border-b border-dashed border-kumo-line transition-colors ${
        isHovered ? 'bg-kumo-brand/15' : 'bg-kumo-overlay/40'
      }`}
    >
      <td colSpan={colSpan} className="px-3 py-1.5 text-center text-[10px] uppercase tracking-wide text-kumo-subtle">
        <span className="inline-flex items-center gap-1.5">
          <ArrowRight size={10} weight="bold" className="-rotate-90" />
          Drop here to move to top level
        </span>
      </td>
    </tr>
  )
}
