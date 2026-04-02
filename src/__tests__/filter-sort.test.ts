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

type AgentLabel = 'in_review' | 'blocked' | 'done' | 'draft'

type StatusFilter = 'blocked' | 'running' | 'idle' | 'errored' | 'completed'
type LabelFilter = AgentLabel

interface FilterState {
  statuses: Set<StatusFilter>
  labels: Set<LabelFilter>
  projects: Set<string>
}

interface AgentRow {
  id: string
  name: string
  projectName: string
  branchName: string
  taskSummary: string
  status: AgentStatus
  label: AgentLabel | null
  model: string
  lastActivityAt: number
}

// ── Logic extracted from src/renderer/src/components/FilterBar.tsx ──

const STATUS_MAP: Record<StatusFilter, AgentStatus[]> = {
  blocked: ['needs_input', 'needs_approval'],
  running: ['running'],
  idle: ['idle'],
  errored: ['errored'],
  completed: ['completed']
}

function matchesFilter(
  agent: { status: AgentStatus; label: AgentLabel | null; projectName: string },
  filter: FilterState
): boolean {
  const hasStatuses = filter.statuses.size > 0
  const hasLabels = filter.labels.size > 0
  const hasProjects = filter.projects.size > 0

  if (!hasStatuses && !hasLabels && !hasProjects) return true

  if (hasStatuses) {
    const allowedStatuses = new Set<AgentStatus>()
    for (const sf of filter.statuses) {
      for (const s of STATUS_MAP[sf]) allowedStatuses.add(s)
    }
    if (!allowedStatuses.has(agent.status)) return false
  }

  if (hasLabels) {
    if (!agent.label || !filter.labels.has(agent.label)) return false
  }

  if (hasProjects) {
    if (!filter.projects.has(agent.projectName)) return false
  }

  return true
}

// ── Sorting and search logic ──

type SortColumn = 'agent' | 'status' | 'task' | 'branch' | 'model' | 'activity'
type SortDirection = 'asc' | 'desc'

function isBlocked(status: AgentStatus): boolean {
  return status === 'needs_input' || status === 'needs_approval'
}

function isUrgent(agent: AgentRow): boolean {
  return isBlocked(agent.status) || agent.status === 'errored' || agent.label === 'blocked'
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
    label: null,
    model: 'sonnet-4',
    lastActivityAt: Date.now(),
    ...overrides
  }
}

const EMPTY: FilterState = { statuses: new Set(), labels: new Set(), projects: new Set() }

function statusFilter(...statuses: StatusFilter[]): FilterState {
  return { statuses: new Set(statuses), labels: new Set(), projects: new Set() }
}

function labelFilter(...labels: LabelFilter[]): FilterState {
  return { statuses: new Set(), labels: new Set(labels), projects: new Set() }
}

function projectFilter(...projects: string[]): FilterState {
  return { statuses: new Set(), labels: new Set(), projects: new Set(projects) }
}

function combinedFilter(statuses: StatusFilter[], projects: string[]): FilterState {
  return { statuses: new Set(statuses), labels: new Set(), projects: new Set(projects) }
}

// ── Tests ──

describe('matchesFilter', () => {
  it('returns true for empty filter (no statuses, no labels, no projects) regardless of status', () => {
    const statuses: AgentStatus[] = [
      'starting', 'running', 'needs_input', 'needs_approval',
      'idle', 'completed', 'errored', 'disconnected', 'stopping'
    ]
    for (const status of statuses) {
      expect(matchesFilter({ status, label: null, projectName: 'proj' }, EMPTY)).toBe(true)
    }
  })

  it('returns true for "blocked" status filter when needs_input or needs_approval', () => {
    const filter = statusFilter('blocked')
    expect(matchesFilter({ status: 'needs_input', label: null, projectName: 'proj' }, filter)).toBe(true)
    expect(matchesFilter({ status: 'needs_approval', label: null, projectName: 'proj' }, filter)).toBe(true)
    expect(matchesFilter({ status: 'running', label: null, projectName: 'proj' }, filter)).toBe(false)
    expect(matchesFilter({ status: 'idle', label: null, projectName: 'proj' }, filter)).toBe(false)
    expect(matchesFilter({ status: 'errored', label: null, projectName: 'proj' }, filter)).toBe(false)
    expect(matchesFilter({ status: 'completed', label: null, projectName: 'proj' }, filter)).toBe(false)
  })

  it('returns true for "running" status filter only when running', () => {
    const filter = statusFilter('running')
    expect(matchesFilter({ status: 'running', label: null, projectName: 'proj' }, filter)).toBe(true)
    expect(matchesFilter({ status: 'idle', label: null, projectName: 'proj' }, filter)).toBe(false)
    expect(matchesFilter({ status: 'needs_input', label: null, projectName: 'proj' }, filter)).toBe(false)
  })

  it('returns true for "idle" status filter only when idle', () => {
    const filter = statusFilter('idle')
    expect(matchesFilter({ status: 'idle', label: null, projectName: 'proj' }, filter)).toBe(true)
    expect(matchesFilter({ status: 'completed', label: null, projectName: 'proj' }, filter)).toBe(false)
    expect(matchesFilter({ status: 'running', label: null, projectName: 'proj' }, filter)).toBe(false)
    expect(matchesFilter({ status: 'errored', label: null, projectName: 'proj' }, filter)).toBe(false)
  })

  it('returns true for "errored" status filter only when errored', () => {
    const filter = statusFilter('errored')
    expect(matchesFilter({ status: 'errored', label: null, projectName: 'proj' }, filter)).toBe(true)
    expect(matchesFilter({ status: 'running', label: null, projectName: 'proj' }, filter)).toBe(false)
    expect(matchesFilter({ status: 'idle', label: null, projectName: 'proj' }, filter)).toBe(false)
  })

  it('returns true for "completed" status filter when completed', () => {
    const filter = statusFilter('completed')
    expect(matchesFilter({ status: 'completed', label: null, projectName: 'proj' }, filter)).toBe(true)
    expect(matchesFilter({ status: 'idle', label: null, projectName: 'proj' }, filter)).toBe(false)
    expect(matchesFilter({ status: 'running', label: null, projectName: 'proj' }, filter)).toBe(false)
    expect(matchesFilter({ status: 'errored', label: null, projectName: 'proj' }, filter)).toBe(false)
  })

  it('matches by project name when project filter is set', () => {
    const filter = projectFilter('my-app')
    expect(matchesFilter({ status: 'running', label: null, projectName: 'my-app' }, filter)).toBe(true)
    expect(matchesFilter({ status: 'running', label: null, projectName: 'other-app' }, filter)).toBe(false)
  })

  // ── Multi-select tests ──

  it('allows multiple statuses to be selected simultaneously', () => {
    const filter = statusFilter('running', 'idle')
    expect(matchesFilter({ status: 'running', label: null, projectName: 'proj' }, filter)).toBe(true)
    expect(matchesFilter({ status: 'idle', label: null, projectName: 'proj' }, filter)).toBe(true)
    expect(matchesFilter({ status: 'completed', label: null, projectName: 'proj' }, filter)).toBe(false)
    expect(matchesFilter({ status: 'needs_input', label: null, projectName: 'proj' }, filter)).toBe(false)
  })

  it('allows multiple projects to be selected simultaneously', () => {
    const filter = projectFilter('app-a', 'app-b')
    expect(matchesFilter({ status: 'running', label: null, projectName: 'app-a' }, filter)).toBe(true)
    expect(matchesFilter({ status: 'running', label: null, projectName: 'app-b' }, filter)).toBe(true)
    expect(matchesFilter({ status: 'running', label: null, projectName: 'app-c' }, filter)).toBe(false)
  })

  it('combines status AND project filters (both must match)', () => {
    const filter = combinedFilter(['running'], ['my-app'])
    expect(matchesFilter({ status: 'running', label: null, projectName: 'my-app' }, filter)).toBe(true)
    expect(matchesFilter({ status: 'running', label: null, projectName: 'other-app' }, filter)).toBe(false)
    expect(matchesFilter({ status: 'idle', label: null, projectName: 'my-app' }, filter)).toBe(false)
    expect(matchesFilter({ status: 'idle', label: null, projectName: 'other-app' }, filter)).toBe(false)
  })

  it('combines multiple statuses AND multiple projects', () => {
    const filter = combinedFilter(['running', 'blocked'], ['app-a', 'app-b'])
    expect(matchesFilter({ status: 'running', label: null, projectName: 'app-a' }, filter)).toBe(true)
    expect(matchesFilter({ status: 'needs_input', label: null, projectName: 'app-b' }, filter)).toBe(true)
    expect(matchesFilter({ status: 'needs_approval', label: null, projectName: 'app-a' }, filter)).toBe(true)
    expect(matchesFilter({ status: 'idle', label: null, projectName: 'app-a' }, filter)).toBe(false)
    expect(matchesFilter({ status: 'running', label: null, projectName: 'app-c' }, filter)).toBe(false)
  })

  it('status-only filter does not restrict by project', () => {
    const filter = statusFilter('running')
    expect(matchesFilter({ status: 'running', label: null, projectName: 'any-project' }, filter)).toBe(true)
    expect(matchesFilter({ status: 'running', label: null, projectName: 'another-project' }, filter)).toBe(true)
  })

  it('project-only filter does not restrict by status', () => {
    const filter = projectFilter('my-app')
    expect(matchesFilter({ status: 'running', label: null, projectName: 'my-app' }, filter)).toBe(true)
    expect(matchesFilter({ status: 'idle', label: null, projectName: 'my-app' }, filter)).toBe(true)
    expect(matchesFilter({ status: 'errored', label: null, projectName: 'my-app' }, filter)).toBe(true)
    expect(matchesFilter({ status: 'completed', label: null, projectName: 'my-app' }, filter)).toBe(true)
  })
})

describe('label filters', () => {
  it('matches agents with a specific label', () => {
    const filter = labelFilter('in_review')
    expect(matchesFilter({ status: 'running', label: 'in_review', projectName: 'proj' }, filter)).toBe(true)
    expect(matchesFilter({ status: 'idle', label: 'in_review', projectName: 'proj' }, filter)).toBe(true)
    expect(matchesFilter({ status: 'running', label: null, projectName: 'proj' }, filter)).toBe(false)
    expect(matchesFilter({ status: 'running', label: 'done', projectName: 'proj' }, filter)).toBe(false)
  })

  it('matches multiple labels', () => {
    const filter = labelFilter('in_review', 'draft')
    expect(matchesFilter({ status: 'running', label: 'in_review', projectName: 'proj' }, filter)).toBe(true)
    expect(matchesFilter({ status: 'running', label: 'draft', projectName: 'proj' }, filter)).toBe(true)
    expect(matchesFilter({ status: 'running', label: 'done', projectName: 'proj' }, filter)).toBe(false)
    expect(matchesFilter({ status: 'running', label: null, projectName: 'proj' }, filter)).toBe(false)
  })

  it('combines status AND label filters', () => {
    const filter: FilterState = {
      statuses: new Set<StatusFilter>(['running']),
      labels: new Set<LabelFilter>(['in_review']),
      projects: new Set()
    }
    expect(matchesFilter({ status: 'running', label: 'in_review', projectName: 'proj' }, filter)).toBe(true)
    expect(matchesFilter({ status: 'idle', label: 'in_review', projectName: 'proj' }, filter)).toBe(false)
    expect(matchesFilter({ status: 'running', label: null, projectName: 'proj' }, filter)).toBe(false)
  })

  it('label filter does not affect agents without labels when not filtering by label', () => {
    const filter = statusFilter('running')
    expect(matchesFilter({ status: 'running', label: null, projectName: 'proj' }, filter)).toBe(true)
    expect(matchesFilter({ status: 'running', label: 'done', projectName: 'proj' }, filter)).toBe(true)
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

  it('does not treat "done" label as urgent', () => {
    const running = createAgent({ id: 'r', status: 'running' })
    const done = createAgent({ id: 'm', status: 'idle', label: 'done' })
    const blocked = createAgent({ id: 'b', status: 'needs_input' })
    const sorted = sortUrgentFirst([done, running, blocked])
    expect(sorted[0].id).toBe('b')
  })

  it('does not treat in_review label as urgent', () => {
    const running = createAgent({ id: 'r', status: 'running' })
    const review = createAgent({ id: 'rv', status: 'idle', label: 'in_review' })
    const blocked = createAgent({ id: 'b', status: 'needs_input' })
    const sorted = sortUrgentFirst([review, running, blocked])
    expect(sorted[0].id).toBe('b')
  })

  it('treats "blocked" label as urgent', () => {
    const running = createAgent({ id: 'r', status: 'running' })
    const blockedLabel = createAgent({ id: 'bm', status: 'idle', label: 'blocked' })
    const idle = createAgent({ id: 'i', status: 'idle' })
    const sorted = sortUrgentFirst([idle, running, blockedLabel])
    expect(sorted[0].id).toBe('bm')
  })
})
