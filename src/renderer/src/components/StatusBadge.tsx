import type { AgentStatus } from '../types'
import { statusLabel } from '../types'

interface StatusBadgeProps {
  status: AgentStatus
}

const statusStyles: Record<AgentStatus, string> = {
  running: 'bg-status-running-bg text-status-running',
  needs_input: 'bg-status-input-bg text-status-input',
  needs_approval: 'bg-status-approval-bg text-status-approval',
  idle: 'bg-status-idle-bg text-status-idle',
  completed: 'bg-status-completed-bg text-status-completed',
  errored: 'bg-status-errored-bg text-status-errored',
  starting: 'bg-kumo-fill text-kumo-subtle',
  stopping: 'bg-kumo-fill text-kumo-subtle',
  disconnected: 'bg-status-errored-bg text-status-errored',
  compacting: 'bg-kumo-warning/20 text-kumo-warning'
}

const pulsing = new Set<AgentStatus>(['needs_input', 'needs_approval', 'errored', 'compacting'])

export function StatusBadge({ status }: StatusBadgeProps) {
  const style = statusStyles[status] ?? 'bg-kumo-fill text-kumo-subtle'
  const shouldPulse = pulsing.has(status)

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${style}`}>
      <span className={`w-1.5 h-1.5 rounded-full bg-current ${shouldPulse ? 'animate-pulse-dot' : ''}`} />
      {statusLabel(status)}
    </span>
  )
}
