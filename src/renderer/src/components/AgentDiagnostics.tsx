import { useEffect, useState } from 'react'
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
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
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
    else if (quiet) activity = 'Waiting for model output'
    else activity = 'Model response in progress'
  }

  return (
    <div data-agent-diagnostics className="shrink-0 px-4 py-2 text-[10px] leading-relaxed text-kumo-subtle break-words">
      <div>{activity}</div>
      <div className="break-all">Workspace: {workspacePath ?? 'unknown'}</div>
      <div className="break-all">Session: {agent.sessionId ?? 'unknown'} · Model: {agent.model}</div>
      <div>
        {lastUpdate
          ? <>
            Last update: <time dateTime={lastUpdate.toISOString()} title={lastUpdate.toLocaleString()}>{lastUpdate.toLocaleTimeString()}</time>
            {' · '}{elapsed(agent.lastActivityAtMs, now)} ago
          </>
          : 'No session updates received yet'}
      </div>
      {retry && <div>{retry.message} · {retry.next > now ? `Next attempt in ${Math.ceil((retry.next - now) / 1000)}s` : 'Waiting for the next retry update'}</div>}
      {activeTools.map((tool) => (
        <div key={tool.id}>
          {tool.name} running for {elapsed(tool.timestamp, now)}
          {tool.childActivityAt ? ` · child updated ${elapsed(tool.childActivityAt, now)} ago` : ''}
        </div>
      ))}
      {agent.status === 'running' && quiet && !retry && activeTools.length === 0 && (
        <div>No tool is running. OpenCode has not reported a cause; this could be provider latency or a silent stall.</div>
      )}
      {latestEvent && <div>Last event: {latestEvent.type} · {elapsed(latestEvent.timestamp, now)} ago · {latestEvent.summary}</div>}
    </div>
  )
}
