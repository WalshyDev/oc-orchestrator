import { describe, it, expect } from 'vitest'

// ── Types extracted from the codebase ──

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

type FilterValue = 'all' | 'blocked' | 'running' | 'idle' | string

interface AgentRow {
  id: string
  name: string
  projectName: string
  branchName: string
  taskSummary: string
  status: AgentStatus
  model: string
  lastActivityAt: number
}

// ── Logic extracted from src/renderer/src/components/FilterBar.tsx ──

function matchesFilter(agent: { status: AgentStatus; projectName: string }, filter: FilterValue): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'blocked':
      return agent.status === 'needs_input' || agent.status === 'needs_approval'
    case 'running':
      return agent.status === 'running'
    case 'idle':
      return agent.status === 'idle' || agent.status === 'completed'
    default:
      return agent.projectName === filter
  }
}

// ── Sorting and search logic ──

type SortColumn = 'agent' | 'status' | 'task' | 'branch' | 'model' | 'activity'
type SortDirection = 'asc' | 'desc'

function isBlocked(status: AgentStatus): boolean {
  return status === 'needs_input' || status === 'needs_approval'
}

function isUrgent(agent: AgentRow): boolean {
  return isBlocked(agent.status) || agent.status === 'errored'
}

function compareAgents(
  agentA: AgentRow,
  agentB: AgentRow,
  column: SortColumn,
  direction: SortDirection
): number {
  const multiplier = direction === 'asc' ? 1 : -1

  switch (column) {
    case 'agent':
      return multiplier * agentA.name.localeCompare(agentB.name)
    case 'status':
      return multiplier * agentA.status.localeCompare(agentB.status)
    case 'task':
      return multiplier * agentA.taskSummary.localeCompare(agentB.taskSummary)
    case 'branch':
      return multiplier * agentA.branchName.localeCompare(agentB.branchName)
    case 'model':
      return multiplier * agentA.model.localeCompare(agentB.model)
    case 'activity':
      return multiplier * (agentA.lastActivityAt - agentB.lastActivityAt)
    default:
      return 0
  }
}

function matchesSearch(agent: AgentRow, query: string): boolean {
  const lower = query.toLowerCase()
  return (
    agent.name.toLowerCase().includes(lower) ||
    agent.projectName.toLowerCase().includes(lower) ||
    agent.taskSummary.toLowerCase().includes(lower) ||
    agent.branchName.toLowerCase().includes(lower) ||
    agent.model.toLowerCase().includes(lower)
  )
}

function sortUrgentFirst(agents: AgentRow[]): AgentRow[] {
  return [...agents].sort((agentA, agentB) => {
    const urgentA = isUrgent(agentA) ? 0 : 1
    const urgentB = isUrgent(agentB) ? 0 : 1
    return urgentA - urgentB
  })
}

// ── Test Helpers ──

function createAgent(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    id: 'agent-1',
    name: 'test-agent',
    projectName: 'my-project',
    branchName: 'main',
    taskSummary: 'Fix the login bug',
    status: 'running',
    model: 'sonnet-4',
    lastActivityAt: Date.now(),
    ...overrides
  }
}

// ── Tests ──

describe('matchesFilter', () => {
  it('returns true for "all" filter regardless of status', () => {
    const statuses: AgentStatus[] = [
      'starting', 'running', 'needs_input', 'needs_approval',
      'idle', 'completed', 'errored', 'disconnected', 'stopping'
    ]
    for (const status of statuses) {
      expect(matchesFilter({ status, projectName: 'proj' }, 'all')).toBe(true)
    }
  })

  it('returns true for "blocked" filter only when needs_input or needs_approval', () => {
    expect(matchesFilter({ status: 'needs_input', projectName: 'proj' }, 'blocked')).toBe(true)
    expect(matchesFilter({ status: 'needs_approval', projectName: 'proj' }, 'blocked')).toBe(true)
    expect(matchesFilter({ status: 'running', projectName: 'proj' }, 'blocked')).toBe(false)
    expect(matchesFilter({ status: 'idle', projectName: 'proj' }, 'blocked')).toBe(false)
    expect(matchesFilter({ status: 'errored', projectName: 'proj' }, 'blocked')).toBe(false)
    expect(matchesFilter({ status: 'completed', projectName: 'proj' }, 'blocked')).toBe(false)
  })

  it('returns true for "running" filter only when running', () => {
    expect(matchesFilter({ status: 'running', projectName: 'proj' }, 'running')).toBe(true)
    expect(matchesFilter({ status: 'idle', projectName: 'proj' }, 'running')).toBe(false)
    expect(matchesFilter({ status: 'needs_input', projectName: 'proj' }, 'running')).toBe(false)
  })

  it('returns true for "idle" filter when idle or completed', () => {
    expect(matchesFilter({ status: 'idle', projectName: 'proj' }, 'idle')).toBe(true)
    expect(matchesFilter({ status: 'completed', projectName: 'proj' }, 'idle')).toBe(true)
    expect(matchesFilter({ status: 'running', projectName: 'proj' }, 'idle')).toBe(false)
    expect(matchesFilter({ status: 'errored', projectName: 'proj' }, 'idle')).toBe(false)
  })

  it('matches by project name for custom filter values', () => {
    expect(matchesFilter({ status: 'running', projectName: 'my-app' }, 'my-app')).toBe(true)
    expect(matchesFilter({ status: 'running', projectName: 'other-app' }, 'my-app')).toBe(false)
  })
})

describe('compareAgents (sorting)', () => {
  it('sorts by agent name ascending', () => {
    const alpha = createAgent({ name: 'alpha' })
    const beta = createAgent({ name: 'beta' })
    expect(compareAgents(alpha, beta, 'agent', 'asc')).toBeLessThan(0)
    expect(compareAgents(beta, alpha, 'agent', 'asc')).toBeGreaterThan(0)
  })

  it('sorts by agent name descending', () => {
    const alpha = createAgent({ name: 'alpha' })
    const beta = createAgent({ name: 'beta' })
    expect(compareAgents(alpha, beta, 'agent', 'desc')).toBeGreaterThan(0)
  })

  it('sorts by status', () => {
    const errored = createAgent({ status: 'errored' })
    const running = createAgent({ status: 'running' })
    expect(compareAgents(errored, running, 'status', 'asc')).toBeLessThan(0)
  })

  it('sorts by task summary', () => {
    const taskA = createAgent({ taskSummary: 'Add feature' })
    const taskB = createAgent({ taskSummary: 'Fix bug' })
    expect(compareAgents(taskA, taskB, 'task', 'asc')).toBeLessThan(0)
  })

  it('sorts by branch name', () => {
    const branchA = createAgent({ branchName: 'feature/abc' })
    const branchB = createAgent({ branchName: 'feature/xyz' })
    expect(compareAgents(branchA, branchB, 'branch', 'asc')).toBeLessThan(0)
  })

  it('sorts by model name', () => {
    const modelA = createAgent({ model: 'gpt-4o' })
    const modelB = createAgent({ model: 'sonnet-4' })
    expect(compareAgents(modelA, modelB, 'model', 'asc')).toBeLessThan(0)
  })

  it('sorts by activity timestamp', () => {
    const older = createAgent({ lastActivityAt: 1000 })
    const newer = createAgent({ lastActivityAt: 2000 })
    expect(compareAgents(older, newer, 'activity', 'asc')).toBeLessThan(0)
    expect(compareAgents(newer, older, 'activity', 'asc')).toBeGreaterThan(0)
  })

  it('returns 0 for equal values', () => {
    const agentA = createAgent({ name: 'same' })
    const agentB = createAgent({ name: 'same' })
    expect(compareAgents(agentA, agentB, 'agent', 'asc')).toBe(0)
  })
})

describe('matchesSearch', () => {
  it('matches agent name', () => {
    const agent = createAgent({ name: 'build-worker' })
    expect(matchesSearch(agent, 'build')).toBe(true)
    expect(matchesSearch(agent, 'worker')).toBe(true)
  })

  it('matches project name', () => {
    const agent = createAgent({ projectName: 'oc-orchestrator' })
    expect(matchesSearch(agent, 'orchestrator')).toBe(true)
  })

  it('matches task summary', () => {
    const agent = createAgent({ taskSummary: 'Implement authentication' })
    expect(matchesSearch(agent, 'auth')).toBe(true)
  })

  it('matches branch name', () => {
    const agent = createAgent({ branchName: 'feature/login-flow' })
    expect(matchesSearch(agent, 'login')).toBe(true)
  })

  it('matches model name', () => {
    const agent = createAgent({ model: 'sonnet-4' })
    expect(matchesSearch(agent, 'sonnet')).toBe(true)
  })

  it('is case-insensitive', () => {
    const agent = createAgent({ name: 'MyAgent' })
    expect(matchesSearch(agent, 'myagent')).toBe(true)
    expect(matchesSearch(agent, 'MYAGENT')).toBe(true)
  })

  it('returns false when no fields match', () => {
    const agent = createAgent()
    expect(matchesSearch(agent, 'zzzznotfound')).toBe(false)
  })

  it('matches empty query against everything', () => {
    const agent = createAgent()
    expect(matchesSearch(agent, '')).toBe(true)
  })
})

describe('sortUrgentFirst', () => {
  it('places needs_input agents before running agents', () => {
    const running = createAgent({ id: 'r', status: 'running' })
    const blocked = createAgent({ id: 'b', status: 'needs_input' })
    const sorted = sortUrgentFirst([running, blocked])
    expect(sorted[0].id).toBe('b')
    expect(sorted[1].id).toBe('r')
  })

  it('places needs_approval agents before idle agents', () => {
    const idle = createAgent({ id: 'idle', status: 'idle' })
    const approval = createAgent({ id: 'approval', status: 'needs_approval' })
    const sorted = sortUrgentFirst([idle, approval])
    expect(sorted[0].id).toBe('approval')
  })

  it('places errored agents before running agents', () => {
    const running = createAgent({ id: 'r', status: 'running' })
    const errored = createAgent({ id: 'e', status: 'errored' })
    const sorted = sortUrgentFirst([running, errored])
    expect(sorted[0].id).toBe('e')
  })

  it('keeps all urgent agents together at the top', () => {
    const agents = [
      createAgent({ id: 'running', status: 'running' }),
      createAgent({ id: 'error', status: 'errored' }),
      createAgent({ id: 'idle', status: 'idle' }),
      createAgent({ id: 'input', status: 'needs_input' }),
      createAgent({ id: 'approval', status: 'needs_approval' })
    ]
    const sorted = sortUrgentFirst(agents)
    const urgentIds = sorted.slice(0, 3).map((agent) => agent.id)
    expect(urgentIds).toContain('error')
    expect(urgentIds).toContain('input')
    expect(urgentIds).toContain('approval')
  })

  it('does not mutate the original array', () => {
    const agents = [
      createAgent({ id: 'r', status: 'running' }),
      createAgent({ id: 'b', status: 'needs_input' })
    ]
    const original = [...agents]
    sortUrgentFirst(agents)
    expect(agents[0].id).toBe(original[0].id)
    expect(agents[1].id).toBe(original[1].id)
  })
})
