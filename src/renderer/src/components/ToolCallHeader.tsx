import { CaretDown, CaretRight } from '@phosphor-icons/react'
import { formatResponseMetadata } from '../lib/transcript-metadata'
import type { ToolCall } from './ToolsUsage'

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

export function ToolCallHeader({ tool, expanded, summary, timestamp }: {
  tool: ToolCall
  expanded?: boolean
  summary?: string
  timestamp?: string
}) {
  const metadata = formatResponseMetadata(tool)

  return (
    <span className="flex min-w-0 w-full flex-col gap-1.5 text-left">
      <span className="flex min-w-0 items-center gap-2">
        <span className={`flex min-w-0 items-center gap-2 ${summary !== undefined ? 'w-32 shrink-0' : 'flex-1'}`}>
          {expanded !== undefined && (
            <span className="shrink-0 text-kumo-subtle">
              {expanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
            </span>
          )}
          <span className="min-w-0 truncate font-mono text-xs font-medium text-kumo-default" title={tool.name}>
            {tool.name}
          </span>
        </span>
        {summary !== undefined && (
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-kumo-subtle" title={summary}>
            {summary}
          </span>
        )}
        {timestamp && <span className="shrink-0 text-[10px] text-kumo-subtle">{timestamp}</span>}
      </span>
      <span className="flex min-w-0 items-center gap-3">
        <span className={`inline-flex w-24 shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium ${stateStyles[tool.state]}`}>
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full bg-current ${tool.state === 'running' ? 'animate-pulse-dot' : ''}`} />
          {stateLabels[tool.state]}
        </span>
        {metadata && (
          <span className="min-w-0 flex-1 truncate text-right font-mono text-[10px] text-kumo-subtle/70" title={metadata}>
            {metadata}
          </span>
        )}
      </span>
    </span>
  )
}
