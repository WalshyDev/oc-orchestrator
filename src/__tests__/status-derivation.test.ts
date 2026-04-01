import { describe, it, expect } from 'vitest'

// ── Extracted logic from src/renderer/src/hooks/useAgentStore.ts ──

type AgentStatus =
  | 'starting'
  | 'running'
  | 'needs_input'
  | 'needs_approval'
  | 'idle'
  | 'completed'
  | 'errored'
  | 'disconnected'
  | 'stopping'

interface AgentRuntime {
  status: AgentStatus
}

function mapSessionStatus(statusType: string): AgentStatus {
  switch (statusType) {
    case 'busy': return 'running'
    case 'idle': return 'idle'
    case 'retry': return 'running'
    case 'completed': return 'completed'
    case 'error': return 'errored'
    case 'waiting': return 'needs_input'
    default: return 'running'
  }
}

function isBlocked(status: AgentStatus): boolean {
  return status === 'needs_input' || status === 'needs_approval'
}

function isUrgent(agent: AgentRuntime): boolean {
  return isBlocked(agent.status) || agent.status === 'errored'
}

function statusLabel(status: AgentStatus): string {
  const labels: Record<AgentStatus, string> = {
    starting: 'Starting',
    running: 'Running',
    needs_input: 'Needs Input',
    needs_approval: 'Needs Approval',
    idle: 'Idle',
    completed: 'Completed',
    errored: 'Errored',
    disconnected: 'Disconnected',
    stopping: 'Stopping'
  }
  return labels[status]
}

function formatModelName(modelId: string): string {
  const claudeMatch = modelId.match(/(sonnet|opus|haiku)-?(\d[\d.]*)?/)
  if (claudeMatch) return claudeMatch[0]

  const gptMatch = modelId.match(/gpt-[\w.-]+/)
  if (gptMatch) return gptMatch[0]

  const oSeriesMatch = modelId.match(/\bo\d[\w-]*/)
  if (oSeriesMatch) return oSeriesMatch[0]

  const geminiMatch = modelId.match(/gemini-[\w.-]+/)
  if (geminiMatch) return geminiMatch[0]

  return modelId.length > 16 ? modelId.slice(0, 16) : modelId
}

// ── Extracted from processEvent message.part.updated handler ──
// Simulates the status update logic when a message part update arrives

interface MinimalAgent {
  status: AgentStatus
  lastActivityAt: number
  blockedSince?: number
}

/**
 * Mirrors the logic in useAgentStore.ts processEvent 'message.part.updated' handler.
 * When a message part update arrives, the agent status should only be reset to 'running'
 * if it's NOT in a blocked state (needs_input or needs_approval).
 */
function applyMessagePartUpdate(agent: MinimalAgent): void {
  agent.lastActivityAt = Date.now()
  if (agent.status !== 'needs_input' && agent.status !== 'needs_approval') {
    agent.status = 'running'
    agent.blockedSince = undefined
  }
}

/**
 * Mirrors the logic in processEvent 'session.status' handler.
 * Sets agent status from a session status event.
 */
function applySessionStatus(agent: MinimalAgent, statusType: string): void {
  const newStatus = mapSessionStatus(statusType)
  agent.status = newStatus
  agent.lastActivityAt = Date.now()
  if (newStatus === 'needs_input' || newStatus === 'needs_approval') {
    agent.blockedSince = agent.blockedSince ?? Date.now()
  } else {
    agent.blockedSince = undefined
  }
}

/**
 * Mirrors the logic in processEvent 'permission.updated' handler.
 */
function applyPermissionUpdate(agent: MinimalAgent): void {
  agent.status = 'needs_approval'
  agent.blockedSince = agent.blockedSince ?? Date.now()
  agent.lastActivityAt = Date.now()
}

// ── Tests ──

describe('mapSessionStatus', () => {
  it('maps "busy" to "running"', () => {
    expect(mapSessionStatus('busy')).toBe('running')
  })

  it('maps "idle" to "idle"', () => {
    expect(mapSessionStatus('idle')).toBe('idle')
  })

  it('maps "completed" to "completed"', () => {
    expect(mapSessionStatus('completed')).toBe('completed')
  })

  it('maps "error" to "errored"', () => {
    expect(mapSessionStatus('error')).toBe('errored')
  })

  it('maps "waiting" to "needs_input"', () => {
    expect(mapSessionStatus('waiting')).toBe('needs_input')
  })

  it('maps "retry" to "running"', () => {
    expect(mapSessionStatus('retry')).toBe('running')
  })

  it('maps unknown status to "running" as default', () => {
    expect(mapSessionStatus('something_unknown')).toBe('running')
    expect(mapSessionStatus('')).toBe('running')
  })
})

describe('isBlocked', () => {
  it('returns true for "needs_input"', () => {
    expect(isBlocked('needs_input')).toBe(true)
  })

  it('returns true for "needs_approval"', () => {
    expect(isBlocked('needs_approval')).toBe(true)
  })

  it('returns false for "running"', () => {
    expect(isBlocked('running')).toBe(false)
  })

  it('returns false for "idle"', () => {
    expect(isBlocked('idle')).toBe(false)
  })

  it('returns false for "completed"', () => {
    expect(isBlocked('completed')).toBe(false)
  })

  it('returns false for "errored"', () => {
    expect(isBlocked('errored')).toBe(false)
  })

  it('returns false for "starting"', () => {
    expect(isBlocked('starting')).toBe(false)
  })

  it('returns false for "disconnected"', () => {
    expect(isBlocked('disconnected')).toBe(false)
  })

  it('returns false for "stopping"', () => {
    expect(isBlocked('stopping')).toBe(false)
  })
})

describe('isUrgent', () => {
  it('returns true when status is "needs_input"', () => {
    expect(isUrgent({ status: 'needs_input' })).toBe(true)
  })

  it('returns true when status is "needs_approval"', () => {
    expect(isUrgent({ status: 'needs_approval' })).toBe(true)
  })

  it('returns true when status is "errored"', () => {
    expect(isUrgent({ status: 'errored' })).toBe(true)
  })

  it('returns false when status is "running"', () => {
    expect(isUrgent({ status: 'running' })).toBe(false)
  })

  it('returns false when status is "idle"', () => {
    expect(isUrgent({ status: 'idle' })).toBe(false)
  })

  it('returns false when status is "completed"', () => {
    expect(isUrgent({ status: 'completed' })).toBe(false)
  })

  it('returns false when status is "starting"', () => {
    expect(isUrgent({ status: 'starting' })).toBe(false)
  })

  it('returns false when status is "disconnected"', () => {
    expect(isUrgent({ status: 'disconnected' })).toBe(false)
  })

  it('returns false when status is "stopping"', () => {
    expect(isUrgent({ status: 'stopping' })).toBe(false)
  })
})

describe('statusLabel', () => {
  it('returns "Starting" for starting', () => {
    expect(statusLabel('starting')).toBe('Starting')
  })

  it('returns "Running" for running', () => {
    expect(statusLabel('running')).toBe('Running')
  })

  it('returns "Needs Input" for needs_input', () => {
    expect(statusLabel('needs_input')).toBe('Needs Input')
  })

  it('returns "Needs Approval" for needs_approval', () => {
    expect(statusLabel('needs_approval')).toBe('Needs Approval')
  })

  it('returns "Idle" for idle', () => {
    expect(statusLabel('idle')).toBe('Idle')
  })

  it('returns "Completed" for completed', () => {
    expect(statusLabel('completed')).toBe('Completed')
  })

  it('returns "Errored" for errored', () => {
    expect(statusLabel('errored')).toBe('Errored')
  })

  it('returns "Disconnected" for disconnected', () => {
    expect(statusLabel('disconnected')).toBe('Disconnected')
  })

  it('returns "Stopping" for stopping', () => {
    expect(statusLabel('stopping')).toBe('Stopping')
  })
})

describe('formatModelName', () => {
  it('extracts Claude sonnet model name', () => {
    expect(formatModelName('claude-sonnet-4-20250514')).toBe('sonnet-4')
  })

  it('extracts Claude opus model name', () => {
    expect(formatModelName('claude-opus-4-20250514')).toBe('opus-4')
  })

  it('extracts Claude haiku model name', () => {
    expect(formatModelName('claude-haiku-3.5-20250101')).toBe('haiku-3.5')
  })

  it('extracts GPT model names', () => {
    expect(formatModelName('gpt-4-turbo')).toBe('gpt-4-turbo')
    expect(formatModelName('gpt-4o')).toBe('gpt-4o')
    expect(formatModelName('gpt-4o-mini')).toBe('gpt-4o-mini')
  })

  it('extracts OpenAI o-series model names', () => {
    expect(formatModelName('o1-preview')).toBe('o1-preview')
    expect(formatModelName('o1-mini')).toBe('o1-mini')
    expect(formatModelName('o3')).toBe('o3')
  })

  it('extracts Gemini model names', () => {
    expect(formatModelName('gemini-1.5-pro')).toBe('gemini-1.5-pro')
    expect(formatModelName('gemini-2.0-flash')).toBe('gemini-2.0-flash')
  })

  it('truncates long unknown model names to 16 chars', () => {
    const longName = 'some-very-long-model-name-that-exceeds'
    expect(formatModelName(longName)).toBe(longName.slice(0, 16))
  })

  it('returns short unknown model names as-is', () => {
    expect(formatModelName('my-model')).toBe('my-model')
  })
})

describe('applyMessagePartUpdate – blocked status preservation', () => {
  it('sets status to running when agent is in starting state', () => {
    const agent: MinimalAgent = { status: 'starting', lastActivityAt: 0 }
    applyMessagePartUpdate(agent)
    expect(agent.status).toBe('running')
  })

  it('keeps status as running when already running', () => {
    const agent: MinimalAgent = { status: 'running', lastActivityAt: 0 }
    applyMessagePartUpdate(agent)
    expect(agent.status).toBe('running')
  })

  it('does NOT clobber needs_input status', () => {
    const blockedAt = Date.now() - 5000
    const agent: MinimalAgent = { status: 'needs_input', lastActivityAt: 0, blockedSince: blockedAt }
    applyMessagePartUpdate(agent)
    expect(agent.status).toBe('needs_input')
    expect(agent.blockedSince).toBe(blockedAt)
  })

  it('does NOT clobber needs_approval status', () => {
    const blockedAt = Date.now() - 5000
    const agent: MinimalAgent = { status: 'needs_approval', lastActivityAt: 0, blockedSince: blockedAt }
    applyMessagePartUpdate(agent)
    expect(agent.status).toBe('needs_approval')
    expect(agent.blockedSince).toBe(blockedAt)
  })

  it('clears blockedSince when transitioning non-blocked state to running', () => {
    const agent: MinimalAgent = { status: 'idle', lastActivityAt: 0, blockedSince: 12345 }
    applyMessagePartUpdate(agent)
    expect(agent.status).toBe('running')
    expect(agent.blockedSince).toBeUndefined()
  })

  it('always updates lastActivityAt', () => {
    const before = Date.now()
    const agent: MinimalAgent = { status: 'needs_input', lastActivityAt: 0, blockedSince: before }
    applyMessagePartUpdate(agent)
    expect(agent.lastActivityAt).toBeGreaterThanOrEqual(before)
  })
})

describe('event sequence: question flow (session.status → message.part.updated)', () => {
  it('preserves needs_input when message.part.updated arrives after session.status waiting', () => {
    // Simulates: AI calls question tool → server sends session.status "waiting" → then message.part.updated for the tool call
    const agent: MinimalAgent = { status: 'running', lastActivityAt: 0 }

    // Step 1: session.status with "waiting" arrives
    applySessionStatus(agent, 'waiting')
    expect(agent.status).toBe('needs_input')
    expect(agent.blockedSince).toBeDefined()

    // Step 2: message.part.updated for the question tool call arrives after
    applyMessagePartUpdate(agent)
    expect(agent.status).toBe('needs_input')
    expect(agent.blockedSince).toBeDefined()
  })

  it('preserves needs_approval when message.part.updated arrives after permission.updated', () => {
    const agent: MinimalAgent = { status: 'running', lastActivityAt: 0 }

    // Step 1: permission.updated arrives
    applyPermissionUpdate(agent)
    expect(agent.status).toBe('needs_approval')
    expect(agent.blockedSince).toBeDefined()

    // Step 2: message.part.updated arrives after
    applyMessagePartUpdate(agent)
    expect(agent.status).toBe('needs_approval')
    expect(agent.blockedSince).toBeDefined()
  })

  it('transitions back to running when session.status busy arrives after needs_input', () => {
    const agent: MinimalAgent = { status: 'running', lastActivityAt: 0 }

    // Agent enters needs_input
    applySessionStatus(agent, 'waiting')
    expect(agent.status).toBe('needs_input')

    // User responds, server sends session.status "busy"
    applySessionStatus(agent, 'busy')
    expect(agent.status).toBe('running')
    expect(agent.blockedSince).toBeUndefined()
  })

  it('handles rapid status transitions without losing blocked state', () => {
    const agent: MinimalAgent = { status: 'running', lastActivityAt: 0 }

    // Multiple message.part.updated while running → stays running
    applyMessagePartUpdate(agent)
    applyMessagePartUpdate(agent)
    expect(agent.status).toBe('running')

    // Enters waiting state
    applySessionStatus(agent, 'waiting')
    expect(agent.status).toBe('needs_input')
    const blockedTime = agent.blockedSince

    // Multiple message.part.updated while blocked → stays needs_input
    applyMessagePartUpdate(agent)
    applyMessagePartUpdate(agent)
    applyMessagePartUpdate(agent)
    expect(agent.status).toBe('needs_input')
    expect(agent.blockedSince).toBe(blockedTime)
  })
})
