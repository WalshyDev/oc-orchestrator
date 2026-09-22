import { describe, expect, it, vi } from 'vitest'
import {
  applyAssistantPrUrlMessage,
  applyAssistantPrUrlPart,
  applyAgentPrUrlUpdate,
  consumePendingAgentPrUrl,
  type LiveAgent
} from '../renderer/src/hooks/useAgentStore'

describe('PR link updates', () => {
  it('persists an explicit assistant directive outside the Create PR flow', () => {
    const prUrl = 'https://gitlab.example.com/group/repo/-/merge_requests/42'
    const agent = { prUrl: null }
    const persist = vi.fn()

    expect(applyAssistantPrUrlMessage(
      agent,
      { parts: [{
        id: 'part-1',
        type: 'text',
        text: `Merge request created.\nSet OCO PR Link for this session to ${prUrl}`
      }] },
      persist
    )).toBe(true)
    expect(agent.prUrl).toBe(prUrl)
    expect(persist).toHaveBeenCalledWith(prUrl)
  })

  it('ignores ordinary and unsupported URLs outside the Create PR flow', () => {
    const agent = { prUrl: null }
    const persist = vi.fn()

    expect(applyAssistantPrUrlPart(
      agent,
      'text',
      'Review https://github.com/example/repo/pull/42',
      false,
      persist
    )).toBe(false)
    expect(applyAssistantPrUrlPart(
      agent,
      'text',
      'Set OCO PR Link for this session to https://example.com/sign-in',
      false,
      persist
    )).toBe(false)
    expect(agent.prUrl).toBeNull()
    expect(persist).not.toHaveBeenCalled()
  })

  it('preserves automatic extraction for the Create PR flow', () => {
    const prUrl = 'https://github.com/example/repo/pull/42'
    const agent = { prUrl: null }
    const persist = vi.fn()

    expect(applyAssistantPrUrlPart(agent, 'tool', `Created ${prUrl}`, true, persist)).toBe(true)
    expect(agent.prUrl).toBe(prUrl)
    expect(persist).toHaveBeenCalledWith(prUrl)
  })

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
