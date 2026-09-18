import { describe, expect, it } from 'vitest'
import {
  applyAgentPrUrlUpdate,
  consumePendingAgentPrUrl,
  type LiveAgent
} from '../renderer/src/hooks/useAgentStore'

describe('PR link updates', () => {
  it('keeps an update that arrives before agent hydration', () => {
    const agents = new Map<string, LiveAgent>()
    const pending = new Map<string, string>()
    const payload = { id: 'agent-1', prUrl: 'https://github.com/example/repo/pull/1' }

    expect(applyAgentPrUrlUpdate(agents, pending, payload)).toBe(false)
    expect(pending.get('agent-1')).toBe(payload.prUrl)

    const agent = { id: 'agent-1', prUrl: null } as LiveAgent
    agents.set(agent.id, agent)
    expect(consumePendingAgentPrUrl(agent, pending)).toBe(true)
    expect(agent.prUrl).toBe(payload.prUrl)
    expect(pending.has('agent-1')).toBe(false)
  })
})
