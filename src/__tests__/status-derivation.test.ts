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
  respondedAt?: number
}

const OPTIMISTIC_GUARD_MS = 5_000

function isWithinOptimisticGuard(agent: MinimalAgent): boolean {
  return agent.respondedAt !== undefined && Date.now() - agent.respondedAt < OPTIMISTIC_GUARD_MS
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
 * @param hasPendingInterrupts - Whether the agent has pending questions/permissions
 */
function applySessionStatus(agent: MinimalAgent, statusType: string, hasPendingInterrupts = false): void {
  const newStatus = mapSessionStatus(statusType)
  // After the user responds, ignore stale 'waiting' status events
  if ((newStatus === 'needs_input' || newStatus === 'needs_approval') && isWithinOptimisticGuard(agent)) {
    return
  }
  // Don't let 'busy' clobber blocked states when interrupts are pending
  if (
    (agent.status === 'needs_input' || agent.status === 'needs_approval') &&
    newStatus === 'running' &&
    hasPendingInterrupts
  ) {
    return
  }
  agent.status = newStatus
  agent.lastActivityAt = Date.now()
  if (newStatus === 'needs_input' || newStatus === 'needs_approval') {
    agent.blockedSince = agent.blockedSince ?? Date.now()
  } else {
    agent.blockedSince = undefined
    agent.respondedAt = undefined
  }
}

/**
 * Mirrors the optimistic update when a user sends a message or replies to a question.
 */
function applyUserResponse(agent: MinimalAgent): void {
  agent.status = 'running'
  agent.blockedSince = undefined
  agent.lastActivityAt = Date.now()
  agent.respondedAt = Date.now()
}

/**
 * Mirrors the logic in processEvent 'permission.updated' handler.
 * A new permission means the server has moved on, so the guard is cleared.
 */
function applyPermissionUpdate(agent: MinimalAgent): void {
  agent.status = 'needs_approval'
  agent.blockedSince = agent.blockedSince ?? Date.now()
  agent.lastActivityAt = Date.now()
  agent.respondedAt = undefined
}

/**
 * Mirrors the logic in processEvent 'question.asked' handler.
 * A new question means the server has moved on, so the guard is cleared.
 */
function applyQuestionAsked(agent: MinimalAgent): void {
  agent.status = 'needs_input'
  agent.blockedSince = agent.blockedSince ?? Date.now()
  agent.lastActivityAt = Date.now()
  agent.respondedAt = undefined
}

/**
 * Mirrors the reconcileStatuses logic — same guard as applySessionStatus
 * but only fires when the server-reported status disagrees with local status.
 */
function applyReconciliation(agent: MinimalAgent, serverStatusType: string): void {
  const serverStatus = mapSessionStatus(serverStatusType)
  if (agent.status === serverStatus) return
  if ((serverStatus === 'needs_input' || serverStatus === 'needs_approval') && isWithinOptimisticGuard(agent)) {
    return
  }
  agent.status = serverStatus
  agent.lastActivityAt = Date.now()
  if (serverStatus === 'needs_input' || serverStatus === 'needs_approval') {
    agent.blockedSince = agent.blockedSince ?? Date.now()
  } else {
    agent.blockedSince = undefined
    agent.respondedAt = undefined
  }
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

  it('does NOT let session.status busy clobber needs_input when questions are pending', () => {
    const agent: MinimalAgent = { status: 'running', lastActivityAt: 0 }

    // question.asked arrives → sets needs_input
    applySessionStatus(agent, 'waiting')
    expect(agent.status).toBe('needs_input')
    const blockedTime = agent.blockedSince

    // session.status busy arrives due to event ordering, but question is still pending
    applySessionStatus(agent, 'busy', true)
    expect(agent.status).toBe('needs_input')
    expect(agent.blockedSince).toBe(blockedTime)
  })

  it('does NOT let session.status busy clobber needs_approval when permissions are pending', () => {
    const agent: MinimalAgent = { status: 'running', lastActivityAt: 0 }

    applyPermissionUpdate(agent)
    expect(agent.status).toBe('needs_approval')

    // session.status busy while permission is pending
    applySessionStatus(agent, 'busy', true)
    expect(agent.status).toBe('needs_approval')
  })

  it('allows session.status busy to clear needs_input once questions are resolved', () => {
    const agent: MinimalAgent = { status: 'running', lastActivityAt: 0 }

    applySessionStatus(agent, 'waiting')
    expect(agent.status).toBe('needs_input')

    // User answered → question removed → hasPendingInterrupts=false
    applySessionStatus(agent, 'busy', false)
    expect(agent.status).toBe('running')
    expect(agent.blockedSince).toBeUndefined()
  })

  it('allows terminal statuses to override needs_input even with pending questions', () => {
    const agent: MinimalAgent = { status: 'needs_input', lastActivityAt: 0, blockedSince: Date.now() }

    // completed/errored should always override, regardless of pending interrupts
    applySessionStatus(agent, 'completed', true)
    expect(agent.status).toBe('completed')
  })
})

describe('optimistic guard: stale blocked events after user response', () => {
  it('ignores stale session.status "waiting" after user responds', () => {
    const agent: MinimalAgent = { status: 'running', lastActivityAt: 0 }

    // Agent enters needs_input
    applySessionStatus(agent, 'waiting')
    expect(agent.status).toBe('needs_input')

    // User sends a response → optimistic update
    applyUserResponse(agent)
    expect(agent.status).toBe('running')
    expect(agent.blockedSince).toBeUndefined()
    expect(agent.respondedAt).toBeDefined()

    // Stale session.status "waiting" arrives (was in-flight before server processed reply)
    applySessionStatus(agent, 'waiting')
    expect(agent.status).toBe('running')
    expect(agent.blockedSince).toBeUndefined()
  })

  it('allows non-blocked status transitions during guard window', () => {
    const agent: MinimalAgent = { status: 'needs_input', lastActivityAt: 0 }

    applyUserResponse(agent)
    expect(agent.status).toBe('running')

    // Server confirms running (busy) → allowed
    applySessionStatus(agent, 'busy')
    expect(agent.status).toBe('running')

    // Server sends idle → allowed
    applySessionStatus(agent, 'idle')
    expect(agent.status).toBe('idle')
  })

  it('clears respondedAt when a non-blocked status arrives', () => {
    const agent: MinimalAgent = { status: 'needs_input', lastActivityAt: 0 }

    applyUserResponse(agent)
    expect(agent.respondedAt).toBeDefined()

    // Server confirms busy → clears the guard
    applySessionStatus(agent, 'busy')
    expect(agent.respondedAt).toBeUndefined()
  })

  it('allows blocked status after guard window expires', () => {
    const agent: MinimalAgent = { status: 'needs_input', lastActivityAt: 0 }

    applyUserResponse(agent)
    // Simulate guard expiry by backdating respondedAt
    agent.respondedAt = Date.now() - OPTIMISTIC_GUARD_MS - 1

    // Now a waiting status should be accepted
    applySessionStatus(agent, 'waiting')
    expect(agent.status).toBe('needs_input')
    expect(agent.blockedSince).toBeDefined()
  })

  it('full cycle: block → respond → stale event → server busy → new block', () => {
    const agent: MinimalAgent = { status: 'running', lastActivityAt: 0 }

    // 1. Agent blocks on question
    applySessionStatus(agent, 'waiting')
    expect(agent.status).toBe('needs_input')

    // 2. User responds
    applyUserResponse(agent)
    expect(agent.status).toBe('running')

    // 3. Stale 'waiting' arrives → ignored
    applySessionStatus(agent, 'waiting')
    expect(agent.status).toBe('running')

    // 4. Server confirms busy → clears guard
    applySessionStatus(agent, 'busy')
    expect(agent.status).toBe('running')
    expect(agent.respondedAt).toBeUndefined()

    // 5. New legitimate question arrives (no guard active)
    applySessionStatus(agent, 'waiting')
    expect(agent.status).toBe('needs_input')
  })

  it('question.asked clears the guard so subsequent events are not suppressed', () => {
    const agent: MinimalAgent = { status: 'needs_input', lastActivityAt: 0 }

    applyUserResponse(agent)
    expect(agent.respondedAt).toBeDefined()

    // A new question arrives — this is a real new block, clears guard
    applyQuestionAsked(agent)
    expect(agent.status).toBe('needs_input')
    expect(agent.respondedAt).toBeUndefined()

    // Subsequent session.status "waiting" is now accepted (guard cleared)
    applySessionStatus(agent, 'busy')
    applySessionStatus(agent, 'waiting')
    expect(agent.status).toBe('needs_input')
  })

  it('permission.updated clears the guard so subsequent events are not suppressed', () => {
    const agent: MinimalAgent = { status: 'needs_input', lastActivityAt: 0 }

    applyUserResponse(agent)
    expect(agent.respondedAt).toBeDefined()

    // A new permission arrives — this is a real new block, clears guard
    applyPermissionUpdate(agent)
    expect(agent.status).toBe('needs_approval')
    expect(agent.respondedAt).toBeUndefined()
  })
})

describe('reconcileStatuses: optimistic guard', () => {
  it('ignores stale server "waiting" during guard window', () => {
    const agent: MinimalAgent = { status: 'needs_input', lastActivityAt: 0 }

    applyUserResponse(agent)
    expect(agent.status).toBe('running')

    // Reconciliation polls server which still says "waiting"
    applyReconciliation(agent, 'waiting')
    expect(agent.status).toBe('running')
  })

  it('allows reconciliation after guard expires', () => {
    const agent: MinimalAgent = { status: 'needs_input', lastActivityAt: 0 }

    applyUserResponse(agent)
    agent.respondedAt = Date.now() - OPTIMISTIC_GUARD_MS - 1

    applyReconciliation(agent, 'waiting')
    expect(agent.status).toBe('needs_input')
    expect(agent.blockedSince).toBeDefined()
  })

  it('allows non-blocked reconciliation during guard window', () => {
    const agent: MinimalAgent = { status: 'needs_input', lastActivityAt: 0 }

    applyUserResponse(agent)

    // Server says idle — that's not blocked, should be accepted
    applyReconciliation(agent, 'idle')
    expect(agent.status).toBe('idle')
    expect(agent.respondedAt).toBeUndefined()
  })

  it('skips reconciliation when statuses already match', () => {
    const agent: MinimalAgent = { status: 'running', lastActivityAt: 0, respondedAt: Date.now() }

    // Server says "busy" → maps to "running" → matches → no change, guard preserved
    applyReconciliation(agent, 'busy')
    expect(agent.status).toBe('running')
    expect(agent.respondedAt).toBeDefined()
  })
})
