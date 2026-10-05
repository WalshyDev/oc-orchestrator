import { useState, useMemo, useEffect, useRef, memo } from 'react'
import { Wrench, CaretDown, CaretRight, MagnifyingGlass } from '@phosphor-icons/react'
import { SubagentProgress } from './SubagentProgress'
import type { ChildTranscriptEntry } from '../lib/subagent-progress'
import { ToolCallHeader } from './ToolCallHeader'
import type { OutputVerbosity } from '../data/settings'
import { useMostRecentExpansion } from '../hooks/useMostRecentExpansion'

export interface ToolCall {
  id: string
  name: string
  state: 'running' | 'completed' | 'failed'
  input?: string
  output?: string
  model?: string
  providerID?: string
  variant?: string
  timestamp: number
  childActivityAt?: number
  /** For the `task` tool — sessionId of the sub-agent, so the UI can
   *  render live progress by reading the child session's messages. */
  childSessionId?: string
  /** For the `task` tool — a flattened snapshot of the sub-agent's
   *  transcript, computed by the app whenever the parent message list
   *  rebuilds. Populated only when `childSessionId` is set. */
  childTranscript?: ChildTranscriptEntry[]
}

interface ToolsUsageProps {
  tools: ToolCall[]
  verbosity?: OutputVerbosity
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

export function shouldAutoExpandTool(tool: ToolCall, verbosity: OutputVerbosity, manuallyCollapsed: boolean): boolean {
  return !manuallyCollapsed && (
    verbosity === 'all' || (verbosity === 'some' && tool.name !== 'task')
  )
}

function toolActivityAt(tool: ToolCall): number {
  if (tool.name === 'task' && tool.state === 'running') {
    return Math.max(tool.timestamp, tool.childActivityAt ?? tool.timestamp)
  }
  return tool.timestamp
}

export function CollapsibleSubagentProgress({
  tool,
  verbosity
}: {
  tool: ToolCall
  verbosity: OutputVerbosity
}) {
  const [expanded, setExpanded] = useState(
    verbosity === 'all' || verbosity === 'recent'
  )
  const previousVerbosityRef = useRef(verbosity)

  useEffect(() => {
    if (previousVerbosityRef.current !== verbosity) {
      setExpanded(verbosity === 'all' || verbosity === 'recent')
      previousVerbosityRef.current = verbosity
    }
  }, [verbosity])

  return (
    <div className="rounded-md border border-kumo-line bg-kumo-overlay">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((previous) => !previous)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[10px] text-kumo-subtle hover:text-kumo-default"
      >
        {expanded ? <CaretDown size={10} /> : <CaretRight size={10} />}
        <span className="font-medium">Subagent output</span>
        <span className="ml-auto">{tool.state === 'running' ? 'Running' : 'Completed'}</span>
      </button>
      {expanded && (
        <div className="border-t border-kumo-line p-2">
          <SubagentProgress
            entries={tool.childTranscript ?? []}
            state={tool.state}
            childSessionId={tool.childSessionId}
          />
        </div>
      )}
    </div>
  )
}

export const ToolsUsage = memo(function ToolsUsage({ tools, verbosity = 'none' }: ToolsUsageProps) {
  const latestToolId = tools.reduce<ToolCall | undefined>((latest, tool) =>
    !latest || toolActivityAt(tool) >= toolActivityAt(latest) ? tool : latest, undefined
  )?.id
  const recentExpansion = useMostRecentExpansion(verbosity === 'recent', latestToolId)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set(
    tools.filter((tool) => shouldAutoExpandTool(tool, verbosity, false)).map((tool) => tool.id)
  ))
  const [filterQuery, setFilterQuery] = useState('')
  const manuallyCollapsedRef = useRef<Set<string>>(new Set())
  const previousVerbosityRef = useRef(verbosity)

  // Expand verbose entries unless the user collapsed them;
  // reset manual collapses when verbosity changes.
  useEffect(() => {
    const verbosityChanged = previousVerbosityRef.current !== verbosity
    if (verbosityChanged) manuallyCollapsedRef.current.clear()
    setExpandedIds((prev) => {
      const next = verbosityChanged ? new Set<string>() : new Set(prev)
      for (const tool of tools) {
        if (shouldAutoExpandTool(tool, verbosity, manuallyCollapsedRef.current.has(tool.id))) {
          next.add(tool.id)
        }
      }
      return next
    })
    previousVerbosityRef.current = verbosity
  }, [verbosity, tools])

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
    if (verbosity === 'recent') {
      recentExpansion.toggle(toolId)
      return
    }
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(toolId)) {
        next.delete(toolId)
        manuallyCollapsedRef.current.add(toolId)
      } else {
        next.add(toolId)
        manuallyCollapsedRef.current.delete(toolId)
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

  const sorted = useMemo(
    () => [...filteredTools].sort((toolA, toolB) => toolB.timestamp - toolA.timestamp),
    [filteredTools]
  )

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
          const isExpanded = verbosity === 'recent'
            ? recentExpansion.expandedId === tool.id
            : expandedIds.has(tool.id)

          return (
            <div
              key={tool.id}
              className="rounded-md bg-kumo-control border border-kumo-line hover:border-kumo-fill-hover transition-colors"
            >
              <button
                type="button"
                onClick={() => toggleExpanded(tool.id)}
                aria-expanded={isExpanded}
                className="w-full min-w-0 px-3 py-2.5 cursor-pointer rounded-md hover:bg-kumo-fill/40 transition-colors"
              >
                <ToolCallHeader tool={tool} expanded={isExpanded} timestamp={formatRelativeTime(tool.timestamp)} />
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
                  {tool.name === 'task' && (tool.state === 'running' || tool.childTranscript?.length) && (
                    <CollapsibleSubagentProgress tool={tool} verbosity={verbosity} />
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
                  {!tool.input && !tool.output && tool.name !== 'task' && (
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
})
