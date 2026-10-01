import { CircleNotch, Warning } from '@phosphor-icons/react'
import type { AgentRuntime, Message } from '../types'
import type { EventEntry } from './EventLog'

function elapsed(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export function AgentActivity({ agent, messages, events }: {
  agent: AgentRuntime
  messages: Message[]
  events: EventEntry[]
}): React.JSX.Element {
  const now = Date.now()
  let turnStart = 0
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role === 'user') {
      turnStart = index + 1
      break
    }
  }
  const currentTurn = messages.slice(turnStart)
  const activeTools = currentTurn.flatMap((message) => message.toolCalls ?? [])
    .filter((tool) => tool.state === 'running')
  const quiet = agent.lastActivityAtMs > 0 && now - agent.lastActivityAtMs >= 60_000
  const latestEvent = events[events.length - 1]
  const retry = agent.retry
  let heading = 'Model response in progress'
  if (retry) {
    heading = `Provider retry #${retry.attempt}`
  } else if (activeTools.length > 0) {
    heading = `Waiting for ${activeTools.map((tool) => tool.name).join(', ')}`
  } else if (quiet) {
    heading = 'Waiting for model output'
  }

  return (
    <div data-agent-activity className="rounded-lg border border-kumo-line bg-kumo-control px-3 py-2 text-[11px] text-kumo-subtle flex flex-col gap-1">
      <div className="flex items-center gap-2 text-kumo-default">
        {retry || quiet ? <Warning size={14} /> : <CircleNotch size={14} className="animate-spin" />}
        <span>{heading}</span>
      </div>
      {retry && <>
        <div className="text-kumo-danger whitespace-pre-wrap break-words">{retry.message}</div>
        <div>{retry.next > now ? `Next attempt in ${Math.ceil((retry.next - now) / 1000)}s` : 'Waiting for the next retry update'}</div>
      </>}
      {activeTools.map((tool) => (
        <div key={tool.id} className="break-words">
          {tool.name} running for {elapsed(tool.timestamp, now)}
          {tool.childActivityAt ? ` · child updated ${elapsed(tool.childActivityAt, now)} ago` : ''}
        </div>
      ))}
      <div>{agent.lastActivityAtMs > 0 ? `Last session update ${elapsed(agent.lastActivityAtMs, now)} ago` : 'No session updates received yet'}</div>
      {quiet && !retry && activeTools.length === 0 && (
        <div>No tool is running. OpenCode has not reported a cause; this could be provider latency or a silent stall.</div>
      )}
      <details>
        <summary className="cursor-pointer">Diagnostics</summary>
        <div className="font-mono break-all mt-1">Session: {agent.sessionId ?? 'unknown'}</div>
        <div className="break-all">Model: {agent.model}</div>
        {latestEvent && <div className="break-words">Last event: {latestEvent.type} · {elapsed(latestEvent.timestamp, now)} ago · {latestEvent.summary}</div>}
      </details>
    </div>
  )
}
