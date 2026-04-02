import { useState, useMemo, useEffect, useRef } from 'react'
import { ListBullets, CaretDown, CaretRight, Funnel } from '@phosphor-icons/react'

export interface EventEntry {
  id: string
  type: string
  summary: string
  timestamp: number
  data: unknown
}

interface EventLogProps {
  events: EventEntry[]
  verbose?: boolean
}

const typeColorMap: Record<string, string> = {
  system: 'bg-kumo-interact/12 text-kumo-link border-kumo-interact/25',
  tool: 'bg-kumo-fill text-kumo-subtle border-kumo-line',
  error: 'bg-kumo-danger/10 text-kumo-danger border-kumo-danger/20',
  message: 'bg-kumo-success/12 text-kumo-success border-kumo-success/25',
  approval: 'bg-status-approval-bg text-status-approval border-status-approval/25',
  completion: 'bg-status-completed-bg text-status-completed border-status-completed/25'
}

const defaultTypeStyle = 'bg-kumo-fill text-kumo-subtle border-kumo-line'

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp)
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')
  const seconds = date.getSeconds().toString().padStart(2, '0')
  const millis = date.getMilliseconds().toString().padStart(3, '0')
  return `${hours}:${minutes}:${seconds}.${millis}`
}

function formatJson(data: unknown): string {
  try {
    return JSON.stringify(data, null, 2)
  } catch {
    return String(data)
  }
}

export function EventLog({ events, verbose = false }: EventLogProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() =>
    verbose ? new Set(events.map((e) => e.id)) : new Set()
  )
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [showFilterMenu, setShowFilterMenu] = useState(false)
  // Track items the user explicitly collapsed so we don't re-expand them
  const manuallyCollapsedRef = useRef<Set<string>>(new Set())

  // When verbose is on, auto-expand only *new* items (not manually-collapsed ones)
  useEffect(() => {
    if (!verbose) return
    setExpandedIds((prev) => {
      const next = new Set(prev)
      for (const event of events) {
        if (!manuallyCollapsedRef.current.has(event.id)) {
          next.add(event.id)
        }
      }
      return next
    })
  }, [verbose, events])

  const eventTypes = useMemo(() => {
    const types = new Set<string>()
    for (const event of events) {
      types.add(event.type)
    }
    return Array.from(types).sort()
  }, [events])

  const filteredEvents = useMemo(() => {
    if (typeFilter === 'all') return events
    return events.filter((event) => event.type === typeFilter)
  }, [events, typeFilter])

  const toggleExpanded = (eventId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(eventId)) {
        next.delete(eventId)
        if (verbose) manuallyCollapsedRef.current.add(eventId)
      } else {
        next.add(eventId)
        manuallyCollapsedRef.current.delete(eventId)
      }
      return next
    })
  }

  if (events.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-kumo-subtle py-12">
        <ListBullets size={28} weight="duotone" />
        <span className="text-sm">No events recorded yet</span>
      </div>
    )
  }

  const sorted = [...filteredEvents].sort((eventA, eventB) => eventB.timestamp - eventA.timestamp)

  return (
    <div className="flex flex-col gap-2 py-2">
      {/* Filter bar */}
      <div className="flex items-center gap-2 px-1">
        <span className="text-[11px] text-kumo-subtle">
          {filteredEvents.length} of {events.length} event{events.length !== 1 ? 's' : ''}
        </span>

        <div className="flex-1" />

        <div className="relative">
          <button
            onClick={() => setShowFilterMenu(!showFilterMenu)}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] border transition-colors cursor-pointer ${
              typeFilter !== 'all'
                ? 'bg-kumo-interact/12 border-kumo-interact/30 text-kumo-link'
                : 'bg-kumo-control border-kumo-line text-kumo-subtle hover:text-kumo-default'
            }`}
          >
            <Funnel size={12} />
            {typeFilter === 'all' ? 'All types' : typeFilter}
            <CaretDown size={10} />
          </button>

          {showFilterMenu && (
            <div className="absolute right-0 top-full mt-1 bg-kumo-elevated border border-kumo-line rounded-md shadow-lg z-10 min-w-[140px] py-1">
              <button
                onClick={() => { setTypeFilter('all'); setShowFilterMenu(false) }}
                className={`w-full text-left px-3 py-1.5 text-[11px] transition-colors cursor-pointer ${
                  typeFilter === 'all' ? 'text-kumo-link bg-kumo-interact/8' : 'text-kumo-default hover:bg-kumo-fill'
                }`}
              >
                All types
              </button>
              {eventTypes.map((eventType) => (
                <button
                  key={eventType}
                  onClick={() => { setTypeFilter(eventType); setShowFilterMenu(false) }}
                  className={`w-full text-left px-3 py-1.5 text-[11px] transition-colors cursor-pointer ${
                    typeFilter === eventType ? 'text-kumo-link bg-kumo-interact/8' : 'text-kumo-default hover:bg-kumo-fill'
                  }`}
                >
                  {eventType}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Event list */}
      <div className="flex flex-col gap-px">
        {sorted.map((event) => {
          const isExpanded = expandedIds.has(event.id)
          const typeStyle = typeColorMap[event.type] || defaultTypeStyle

          return (
            <div
              key={event.id}
              className="bg-kumo-control border border-kumo-line rounded-md hover:border-kumo-fill-hover transition-colors"
            >
              <button
                onClick={() => toggleExpanded(event.id)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 cursor-pointer"
              >
                <span className="shrink-0 text-kumo-subtle">
                  {isExpanded ? <CaretDown size={10} /> : <CaretRight size={10} />}
                </span>

                <span className="shrink-0 font-mono text-[10px] text-kumo-subtle">
                  {formatTimestamp(event.timestamp)}
                </span>

                <span
                  className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${typeStyle}`}
                >
                  {event.type}
                </span>

                <span className="text-xs text-kumo-default truncate text-left">
                  {event.summary}
                </span>
              </button>

              {isExpanded && (
                <div className="px-2.5 pb-2.5 border-t border-kumo-line pt-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-kumo-subtle mb-1">
                    Event Data
                  </div>
                  <pre className="font-mono text-[11px] px-2.5 py-2 bg-kumo-overlay rounded-md text-kumo-subtle overflow-x-auto whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
                    {formatJson(event.data)}
                  </pre>
                </div>
              )}
            </div>
          )
        })}

        {sorted.length === 0 && typeFilter !== 'all' && (
          <div className="text-center text-kumo-subtle text-xs py-6">
            No events of type &ldquo;{typeFilter}&rdquo;
          </div>
        )}
      </div>
    </div>
  )
}
