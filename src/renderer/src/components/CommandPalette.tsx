import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  MagnifyingGlass,
  Play,
  Stop,
  CheckCircle,
  GearSix,
  ArrowRight,
  Robot,
  SquaresFour,
  Warning,
  CircleNotch,
  ClockCounterClockwise
} from '@phosphor-icons/react'
import { EMPTY_FILTER, type FilterState, type StatusFilter } from './FilterBar'

interface CommandPaletteProps {
  agents: Array<{ id: string; name: string; projectName: string; status: string }>
  onClose: () => void
  onSelectAgent: (id: string) => void
  onLaunchAgent: () => void
  onResumeSession: () => void
  onOpenSettings: () => void
  onFilterChange: (filter: FilterState) => void
  onStopAll: () => void
  onApproveAll: () => void
}

interface CommandItem {
  id: string
  label: string
  description?: string
  icon: React.ReactNode
  category: 'agents' | 'actions' | 'navigation'
  shortcut?: string
  action: () => void
}

const CATEGORY_LABELS: Record<string, string> = {
  agents: 'AGENTS',
  actions: 'ACTIONS',
  navigation: 'NAVIGATION'
}

const CATEGORY_ORDER: string[] = ['actions', 'navigation', 'agents']

function statusIcon(status: string): React.ReactNode {
  switch (status) {
    case 'running':
      return <CircleNotch size={14} className="text-status-running animate-spin" />
    case 'blocked':
    case 'input_required':
    case 'approval_required':
      return <Warning size={14} className="text-status-input" />
    default:
      return <Robot size={14} className="text-kumo-subtle" />
  }
}

export function CommandPalette({
  agents,
  onClose,
  onSelectAgent,
  onLaunchAgent,
  onResumeSession,
  onOpenSettings,
  onFilterChange,
  onStopAll,
  onApproveAll
}: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  // Debounce the search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query)
    }, 100)
    return () => clearTimeout(timer)
  }, [query])

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Build the full command list
  const allCommands = useMemo<CommandItem[]>(() => {
    const actionCommands: CommandItem[] = [
      {
        id: 'action-launch',
        label: 'Launch Agent',
        description: 'Start a new agent instance',
        icon: <Play size={16} weight="bold" className="text-kumo-success" />,
        category: 'actions',
        shortcut: '⌘L',
        action: () => {
          onClose()
          onLaunchAgent()
        }
      },
      {
        id: 'action-resume',
        label: 'Resume Session',
        description: 'Import an existing session from a project',
        icon: <ClockCounterClockwise size={16} weight="bold" className="text-kumo-link" />,
        category: 'actions',
        shortcut: 'R',
        action: () => {
          onClose()
          onResumeSession()
        }
      },
      {
        id: 'action-stop-all',
        label: 'Stop All Agents',
        description: 'Terminate every running agent',
        icon: <Stop size={16} weight="bold" className="text-kumo-danger" />,
        category: 'actions',
        action: () => {
          onClose()
          onStopAll()
        }
      },
      {
        id: 'action-approve-all',
        label: 'Approve All Blocked',
        description: 'Approve all pending agent requests',
        icon: <CheckCircle size={16} weight="bold" className="text-kumo-warning" />,
        category: 'actions',
        action: () => {
          onClose()
          onApproveAll()
        }
      },
      {
        id: 'action-settings',
        label: 'Open Settings',
        description: 'Configure orchestrator preferences',
        icon: <GearSix size={16} className="text-kumo-subtle" />,
        category: 'actions',
        shortcut: '⌘,',
        action: () => {
          onClose()
          onOpenSettings()
        }
      }
    ]

    const navigationCommands: CommandItem[] = [
      {
        id: 'nav-fleet',
        label: 'Go to Fleet Board',
        description: 'View the full agent fleet',
        icon: <SquaresFour size={16} className="text-kumo-link" />,
        category: 'navigation',
        action: () => {
          onClose()
          onFilterChange(EMPTY_FILTER)
        }
      },
      {
        id: 'nav-blocked',
        label: 'View Blocked Agents',
        description: 'Filter to agents needing attention',
        icon: <Warning size={16} className="text-kumo-danger" />,
        category: 'navigation',
        action: () => {
          onClose()
          onFilterChange({ ...EMPTY_FILTER, statuses: new Set<StatusFilter>(['blocked']) })
        }
      },
      {
        id: 'nav-running',
        label: 'View Running Agents',
        description: 'Filter to actively running agents',
        icon: <CircleNotch size={16} className="text-kumo-success" />,
        category: 'navigation',
        action: () => {
          onClose()
          onFilterChange({ ...EMPTY_FILTER, statuses: new Set<StatusFilter>(['running']) })
        }
      }
    ]

    const agentCommands: CommandItem[] = agents.map((agent) => ({
      id: `agent-${agent.id}`,
      label: agent.name || agent.id,
      description: agent.projectName,
      icon: statusIcon(agent.status),
      category: 'agents' as const,
      action: () => {
        onClose()
        onSelectAgent(agent.id)
      }
    }))

    return [...actionCommands, ...navigationCommands, ...agentCommands]
  }, [agents, onClose, onSelectAgent, onLaunchAgent, onResumeSession, onOpenSettings, onFilterChange, onStopAll, onApproveAll])

  // Filter commands based on debounced query
  const filteredCommands = useMemo(() => {
    if (!debouncedQuery.trim()) return allCommands

    const lowerQuery = debouncedQuery.toLowerCase()
    return allCommands.filter((command) => {
      const matchLabel = command.label.toLowerCase().includes(lowerQuery)
      const matchDescription = command.description?.toLowerCase().includes(lowerQuery)
      const matchCategory = command.category.toLowerCase().includes(lowerQuery)
      return matchLabel || matchDescription || matchCategory
    })
  }, [allCommands, debouncedQuery])

  // Group commands by category in defined order
  const groupedCommands = useMemo(() => {
    const groups: Array<{ category: string; items: CommandItem[] }> = []

    for (const category of CATEGORY_ORDER) {
      const items = filteredCommands.filter((cmd) => cmd.category === category)
      if (items.length > 0) {
        groups.push({ category, items })
      }
    }

    return groups
  }, [filteredCommands])

  // Flat list for keyboard navigation
  const flatList = useMemo(() => {
    return groupedCommands.flatMap((group) => group.items)
  }, [groupedCommands])

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [debouncedQuery])

  // Scroll selected item into view
  useEffect(() => {
    const selectedElement = itemRefs.current.get(selectedIndex)
    if (selectedElement) {
      selectedElement.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  const executeSelected = useCallback(() => {
    const selected = flatList[selectedIndex]
    if (selected) {
      selected.action()
    }
  }, [flatList, selectedIndex])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault()
          setSelectedIndex((prev) => (prev + 1) % Math.max(flatList.length, 1))
          break
        case 'ArrowUp':
          event.preventDefault()
          setSelectedIndex((prev) => (prev - 1 + flatList.length) % Math.max(flatList.length, 1))
          break
        case 'Enter':
          event.preventDefault()
          executeSelected()
          break
        case 'Escape':
          event.preventDefault()
          onClose()
          break
      }
    },
    [flatList.length, executeSelected, onClose]
  )

  // Track flat index across grouped rendering
  let flatIndex = -1

  return (
    <div
      className="fixed inset-0 z-[300] flex items-start justify-center pt-[12vh] bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-[520px] max-h-[420px] bg-kumo-elevated border border-kumo-line rounded-xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-kumo-line">
          <MagnifyingGlass size={18} className="text-kumo-subtle shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Type a command or search..."
            className="flex-1 bg-transparent text-sm text-kumo-default outline-none placeholder:text-kumo-subtle"
          />
          <kbd className="shrink-0 font-mono text-[10px] px-1.5 py-0.5 bg-kumo-fill rounded border border-kumo-line text-kumo-subtle">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="flex-1 overflow-y-auto py-1">
          {flatList.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-kumo-subtle">
              No matching commands
            </div>
          )}

          {groupedCommands.map((group) => (
            <div key={group.category}>
              {/* Category header */}
              <div className="px-4 pt-2.5 pb-1 text-[10px] font-semibold text-kumo-subtle uppercase tracking-wider">
                {CATEGORY_LABELS[group.category] ?? group.category}
              </div>

              {/* Items */}
              {group.items.map((command) => {
                flatIndex++
                const currentIndex = flatIndex
                const isSelected = currentIndex === selectedIndex

                return (
                  <div
                    key={command.id}
                    ref={(element) => {
                      if (element) {
                        itemRefs.current.set(currentIndex, element)
                      } else {
                        itemRefs.current.delete(currentIndex)
                      }
                    }}
                    onClick={() => command.action()}
                    onMouseEnter={() => setSelectedIndex(currentIndex)}
                    className={`flex items-center gap-3 px-4 py-2 mx-1 rounded-lg cursor-pointer transition-colors ${
                      isSelected ? 'bg-kumo-interact/15 text-kumo-strong' : 'text-kumo-default hover:bg-kumo-fill'
                    }`}
                  >
                    <span className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md bg-kumo-control border border-kumo-line">
                      {command.icon}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{command.label}</div>
                      {command.description && (
                        <div className="text-xs text-kumo-subtle truncate">{command.description}</div>
                      )}
                    </div>
                    {command.shortcut && (
                      <kbd className="shrink-0 font-mono text-[10px] px-1.5 py-0.5 bg-kumo-fill rounded border border-kumo-line text-kumo-subtle">
                        {command.shortcut}
                      </kbd>
                    )}
                    <ArrowRight
                      size={12}
                      className={`shrink-0 transition-opacity ${isSelected ? 'opacity-60' : 'opacity-0'}`}
                    />
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-3 px-4 py-2 border-t border-kumo-line text-[10px] text-kumo-subtle">
          <span className="flex items-center gap-1">
            <kbd className="font-mono px-1 py-px bg-kumo-fill rounded border border-kumo-line">↑↓</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="font-mono px-1 py-px bg-kumo-fill rounded border border-kumo-line">↵</kbd>
            select
          </span>
          <span className="flex items-center gap-1">
            <kbd className="font-mono px-1 py-px bg-kumo-fill rounded border border-kumo-line">esc</kbd>
            close
          </span>
        </div>
      </div>
    </div>
  )
}
