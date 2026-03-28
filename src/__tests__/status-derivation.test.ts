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
