import { useEffect, useState } from 'react'
import { CaretDown } from '@phosphor-icons/react'
import { statusLabel, type AgentRuntime, type Message } from '../types'
import type { EventEntry } from './EventLog'

function elapsed(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export function AgentDiagnostics({ agent, workspacePath, messages, events }: {
  agent: AgentRuntime
  workspacePath?: string
  messages: Message[]
  events: EventEntry[]
}): React.JSX.Element {
  const [now, setNow] = useState(Date.now)
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    if (!expanded) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [expanded])
  let turnStart = 0
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role === 'user') {
      turnStart = index + 1
      break
    }
  }
  const activeTools = agent.status === 'running'
    ? messages.slice(turnStart).flatMap((message) => message.toolCalls ?? [])
      .filter((tool) => tool.state === 'running')
    : []
  const retry = agent.status === 'running' ? agent.retry : undefined
  const quiet = agent.lastActivityAtMs > 0 && now - agent.lastActivityAtMs >= 60_000
  const latestEvent = events[events.length - 1]
  const lastUpdate = Number.isFinite(agent.lastActivityAtMs) && agent.lastActivityAtMs > 0
    ? new Date(agent.lastActivityAtMs)
    : undefined
  let activity = statusLabel(agent.status)
  if (agent.status === 'running') {
    if (retry) activity = `Provider retry #${retry.attempt}`
    else if (activeTools.length > 0) activity = `Waiting for ${activeTools.map((tool) => tool.name).join(', ')}`
    else if (quiet) activity = 'Waiting for model output. No tool is running. OpenCode has not reported a cause; this could be provider latency or a silent stall.'
    else activity = 'Model response in progress'
  }

  const toolActivity = activeTools.map((tool) => (
    `${tool.name} running for ${elapsed(tool.timestamp, now)}`
    + (tool.childActivityAt ? ` · child updated ${elapsed(tool.childActivityAt, now)} ago` : '')
  )).join('; ') || 'None running'
  const retryTiming = retry && retry.next > now
    ? `Next attempt in ${Math.ceil((retry.next - now) / 1000)}s`
    : 'Waiting for the next retry update'
  const providerActivity = retry
    ? `${retry.message} · ${retryTiming}`
    : 'No retry reported'
  const rows = [
    { label: 'Activity', value: activity },
    { label: 'Workspace', value: workspacePath ?? 'unknown' },
    { label: 'Session', value: agent.sessionId ?? 'unknown' },
    { label: 'Model', value: agent.model },
    { label: 'Variant', value: agent.variant || 'Default' },
    {
      label: 'Last update',
      title: lastUpdate?.toLocaleString(),
      value: lastUpdate
        ? <>
          <time dateTime={lastUpdate.toISOString()}>{lastUpdate.toLocaleTimeString()}</time>
          {' · '}{elapsed(agent.lastActivityAtMs, now)} ago
        </>
        : 'No session updates received yet'
    },
    { label: 'Tools', value: toolActivity },
    { label: 'Provider', value: providerActivity },
    {
      label: 'Last event',
      value: latestEvent
        ? `${latestEvent.type} · ${elapsed(latestEvent.timestamp, now)} ago · ${latestEvent.summary}`
        : 'No events received yet'
    }
  ]

  return (
    <div data-agent-diagnostics className="shrink-0 px-4 py-2 text-[10px] leading-relaxed text-kumo-subtle break-words">
      <details className="group" onToggle={(event) => {
        setExpanded(event.currentTarget.open)
        setNow(Date.now())
      }}>
        <summary className="flex w-fit cursor-pointer list-none items-center gap-1 [&::-webkit-details-marker]:hidden">
          Diagnostics <CaretDown size={10} aria-hidden="true" className="group-open:rotate-180" />
        </summary>
        <div className="mt-1">
          {rows.map((row) => (
            <div
              key={row.label}
              data-diagnostic-field={row.label}
              className="truncate"
              title={row.title ?? (typeof row.value === 'string' ? `${row.label}: ${row.value}` : undefined)}
            >
              {row.label}: {row.value}
            </div>
          ))}
        </div>
      </details>
    </div>
  )
}
