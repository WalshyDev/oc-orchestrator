import { describe, it, expect, beforeEach } from 'vitest'

// Mirror of the notifyIfNeeded logic from useAgentStore.ts,
// extracted to test the viewed-agent suppression without React deps.

type AgentStatus = 'starting' | 'running' | 'idle' | 'completed' | 'errored' | 'disconnected' | 'stopping' | 'needs_input' | 'needs_approval'

interface MinimalAgent {
  id: string
  status: AgentStatus
  name: string
  projectName?: string
}

const NOTIFIABLE_STATUSES = new Set(['needs_approval', 'needs_input', 'errored', 'completed', 'disconnected', 'idle'])

class NotifyIfNeededHarness {
  viewedAgentId: string | null = null
  notified: Array<{ agentId: string; status: string; agentName: string; projectName?: string }> = []

  setViewedAgentId(agentId: string | null): void {
    this.viewedAgentId = agentId
  }

  notifyIfNeeded(agent: MinimalAgent, newStatus: string): void {
    if (agent.status === newStatus) return
    if (!NOTIFIABLE_STATUSES.has(newStatus)) return

    // Don't notify for the agent whose transcript is currently open
    if (agent.id === this.viewedAgentId) return

    const notifyStatus = (newStatus === 'idle' && agent.status === 'running') ? 'completed' : newStatus
    if (notifyStatus === 'idle') return

    this.notified.push({ agentId: agent.id, status: notifyStatus, agentName: agent.name, projectName: agent.projectName })
  }
}

describe('viewed-agent notification suppression', () => {
  let harness: NotifyIfNeededHarness

  beforeEach(() => {
    harness = new NotifyIfNeededHarness()
  })

  it('sends notification when no agent is being viewed', () => {
    const agent: MinimalAgent = { id: 'agent-1', status: 'running', name: 'Alpha' }
    harness.notifyIfNeeded(agent, 'errored')
    expect(harness.notified).toHaveLength(1)
    expect(harness.notified[0].agentId).toBe('agent-1')
  })

  it('suppresses notification for the currently viewed agent', () => {
    harness.setViewedAgentId('agent-1')
    const agent: MinimalAgent = { id: 'agent-1', status: 'running', name: 'Alpha' }
    harness.notifyIfNeeded(agent, 'errored')
    expect(harness.notified).toHaveLength(0)
  })

  it('still notifies for other agents while one is viewed', () => {
    harness.setViewedAgentId('agent-1')
    const agent2: MinimalAgent = { id: 'agent-2', status: 'running', name: 'Beta' }
    harness.notifyIfNeeded(agent2, 'needs_approval')
    expect(harness.notified).toHaveLength(1)
    expect(harness.notified[0].agentId).toBe('agent-2')
  })

  it('resumes notifications after closing the drawer (viewed = null)', () => {
    harness.setViewedAgentId('agent-1')
    const agent: MinimalAgent = { id: 'agent-1', status: 'running', name: 'Alpha' }
    harness.notifyIfNeeded(agent, 'errored')
    expect(harness.notified).toHaveLength(0)

    // Close the drawer
    harness.setViewedAgentId(null)
    harness.notifyIfNeeded(agent, 'needs_input')
    expect(harness.notified).toHaveLength(1)
  })

  it('suppresses all event types for the viewed agent', () => {
    harness.setViewedAgentId('agent-1')
    const agent: MinimalAgent = { id: 'agent-1', status: 'running', name: 'Alpha' }

    harness.notifyIfNeeded(agent, 'needs_approval')
    harness.notifyIfNeeded(agent, 'needs_input')
    harness.notifyIfNeeded(agent, 'errored')
    harness.notifyIfNeeded(agent, 'completed')
    harness.notifyIfNeeded(agent, 'disconnected')

    expect(harness.notified).toHaveLength(0)
  })

  it('switches suppression when viewing a different agent', () => {
    harness.setViewedAgentId('agent-1')

    const agent1: MinimalAgent = { id: 'agent-1', status: 'running', name: 'Alpha' }
    const agent2: MinimalAgent = { id: 'agent-2', status: 'running', name: 'Beta' }

    harness.notifyIfNeeded(agent1, 'errored')
    harness.notifyIfNeeded(agent2, 'errored')
    expect(harness.notified).toHaveLength(1)
    expect(harness.notified[0].agentId).toBe('agent-2')

    // Switch to viewing agent-2
    harness.setViewedAgentId('agent-2')
    harness.notified = []

    // agent-1 status changed so it can notify again
    const agent1b: MinimalAgent = { id: 'agent-1', status: 'errored', name: 'Alpha' }
    harness.notifyIfNeeded(agent1b, 'needs_input')
    const agent2b: MinimalAgent = { id: 'agent-2', status: 'errored', name: 'Beta' }
    harness.notifyIfNeeded(agent2b, 'needs_input')

    expect(harness.notified).toHaveLength(1)
    expect(harness.notified[0].agentId).toBe('agent-1')
  })

  // Verify existing notifyIfNeeded semantics are preserved:

  it('does not notify when status has not changed', () => {
    const agent: MinimalAgent = { id: 'agent-1', status: 'errored', name: 'Alpha' }
    harness.notifyIfNeeded(agent, 'errored')
    expect(harness.notified).toHaveLength(0)
  })

  it('does not notify for non-notifiable statuses', () => {
    const agent: MinimalAgent = { id: 'agent-1', status: 'idle', name: 'Alpha' }
    harness.notifyIfNeeded(agent, 'running')
    expect(harness.notified).toHaveLength(0)
  })

  it('treats running→idle as completed', () => {
    const agent: MinimalAgent = { id: 'agent-1', status: 'running', name: 'Alpha' }
    harness.notifyIfNeeded(agent, 'idle')
    expect(harness.notified).toHaveLength(1)
    expect(harness.notified[0].status).toBe('completed')
  })

  it('does not notify for idle→idle transition (not from running)', () => {
    const agent: MinimalAgent = { id: 'agent-1', status: 'needs_input', name: 'Alpha' }
    harness.notifyIfNeeded(agent, 'idle')
    expect(harness.notified).toHaveLength(0)
  })
})
