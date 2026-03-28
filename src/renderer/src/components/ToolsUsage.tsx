import { useState, useMemo } from 'react'
import { Wrench, CaretDown, CaretRight, MagnifyingGlass } from '@phosphor-icons/react'

export interface ToolCall {
  id: string
  name: string
  state: 'running' | 'completed' | 'failed'
  input?: string
  output?: string
  timestamp: number
}

interface ToolsUsageProps {
  tools: ToolCall[]
}

const stateStyles: Record<ToolCall['state'], string> = {
  running: 'bg-kumo-interact/12 text-kumo-link border-kumo-interact/25',
  completed: 'bg-kumo-success/12 text-kumo-success border-kumo-success/25',
  failed: 'bg-kumo-danger/10 text-kumo-danger border-kumo-danger/20'
}

const stateLabels: Record<ToolCall['state'], string> = {
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed'
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function ToolsUsage({ tools }: ToolsUsageProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [filterQuery, setFilterQuery] = useState('')

  const toolNameCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const tool of tools) {
      counts[tool.name] = (counts[tool.name] || 0) + 1
    }
    return counts
  }, [tools])

  const filteredTools = useMemo(() => {
    if (!filterQuery.trim()) return tools
    const query = filterQuery.toLowerCase()
    return tools.filter((tool) => tool.name.toLowerCase().includes(query))
  }, [tools, filterQuery])

  const toggleExpanded = (toolId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(toolId)) {
        next.delete(toolId)
      } else {
        next.add(toolId)
      }
      return next
    })
  }

  if (tools.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-kumo-subtle py-12">
        <Wrench size={28} weight="duotone" />
        <span className="text-sm">No tools used yet</span>
      </div>
    )
  }

  const sorted = [...filteredTools].sort((toolA, toolB) => toolB.timestamp - toolA.timestamp)

  return (
    <div className="flex flex-col gap-2 py-2">
      {/* Summary header */}
      <div className="flex items-center gap-2 flex-wrap px-1">
        <span className="text-[11px] text-kumo-subtle">
          {tools.length} call{tools.length !== 1 ? 's' : ''}
        </span>
        <div className="w-px h-3.5 bg-kumo-line" />
        {Object.entries(toolNameCounts).map(([toolName, count]) => (
          <span
            key={toolName}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-kumo-fill text-[10px] font-mono text-kumo-subtle"
          >
            {toolName}
            <span className="text-kumo-default">{count}</span>
          </span>
        ))}
      </div>

      {/* Filter input */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-kumo-control border border-kumo-line rounded-md mx-1">
        <MagnifyingGlass size={13} className="text-kumo-subtle shrink-0" />
        <input
          type="text"
          value={filterQuery}
          onChange={(event) => setFilterQuery(event.target.value)}
          placeholder="Filter by tool name..."
          className="bg-transparent border-none outline-none text-kumo-default text-xs font-sans w-full placeholder:text-kumo-subtle"
        />
      </div>

      {/* Tool call timeline */}
      <div className="flex flex-col gap-1">
        {sorted.map((tool) => {
          const isExpanded = expandedIds.has(tool.id)

          return (
            <div
              key={tool.id}
              className="rounded-md bg-kumo-control border border-kumo-line hover:border-kumo-fill-hover transition-colors"
            >
              <button
                onClick={() => toggleExpanded(tool.id)}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 cursor-pointer"
              >
                <span className="shrink-0 text-kumo-subtle">
                  {isExpanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
                </span>

                <span className="font-mono text-xs text-kumo-default">{tool.name}</span>

                <span
                  className={`shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${stateStyles[tool.state]}`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full bg-current ${tool.state === 'running' ? 'animate-pulse-dot' : ''}`}
                  />
                  {stateLabels[tool.state]}
                </span>

                <span className="flex-1" />

                <span className="shrink-0 text-[10px] text-kumo-subtle font-mono">
                  {formatRelativeTime(tool.timestamp)}
                </span>
              </button>

              {isExpanded && (
                <div className="px-2.5 pb-2.5 flex flex-col gap-2 border-t border-kumo-line pt-2">
                  {tool.input && (
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-kumo-subtle mb-1">
                        Input
                      </div>
                      <pre className="font-mono text-[11px] px-2.5 py-1.5 bg-kumo-overlay rounded-md text-kumo-subtle overflow-x-auto whitespace-pre-wrap break-all">
                        {tool.input}
                      </pre>
                    </div>
                  )}
                  {tool.output && (
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-kumo-subtle mb-1">
                        Output
                      </div>
                      <pre className="font-mono text-[11px] px-2.5 py-1.5 bg-kumo-overlay rounded-md text-kumo-subtle overflow-x-auto whitespace-pre-wrap break-all">
                        {tool.output}
                      </pre>
                    </div>
                  )}
                  {!tool.input && !tool.output && (
                    <div className="text-[11px] text-kumo-subtle italic">No input/output data</div>
                  )}
                </div>
              )}
            </div>
          )
        })}

        {sorted.length === 0 && filterQuery && (
          <div className="text-center text-kumo-subtle text-xs py-6">
            No tools matching &ldquo;{filterQuery}&rdquo;
          </div>
        )}
      </div>
    </div>
  )
}
