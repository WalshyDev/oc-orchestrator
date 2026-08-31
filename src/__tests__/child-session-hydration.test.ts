import type { OpencodeClient } from '@opencode-ai/sdk/v2/client'
import { describe, expect, it, vi } from 'vitest'
import {
  buildSessionOwnerIndex,
  collectChildSessionIds,
  collectChildSessionTranscripts,
  groupRequestsByOwner
} from '../main/services/child-session-hydration'

describe('child session hydration', () => {
  it('hydrates concurrent children and nested descendants', async () => {
    const children = new Map([
      ['parent', [{ id: 'child-a', parentID: 'parent' }, { id: 'child-b', parentID: 'parent' }]],
      ['child-a', [{ id: 'grandchild', parentID: 'child-a' }]],
      ['child-b', []],
      ['grandchild', []]
    ])
    const messages = new Map([
      ['child-a', ['a message']],
      ['child-b', ['b message']],
      ['grandchild', ['nested message']]
    ])
    const client = {
      session: {
        children: vi.fn(async ({ sessionID }: { sessionID: string }) => ({
          data: children.get(sessionID) ?? []
        })),
        messages: vi.fn(async ({ sessionID }: { sessionID: string }) => ({
          data: messages.get(sessionID) ?? []
        }))
      }
    } as unknown as OpencodeClient

    const result = await collectChildSessionTranscripts(client, 'parent', '/repo')

    expect(result).toEqual({
      complete: true,
      sessions: [
        { info: { id: 'child-a', parentID: 'parent' }, messages: ['a message'] },
        { info: { id: 'child-b', parentID: 'parent' }, messages: ['b message'] },
        { info: { id: 'grandchild', parentID: 'child-a' }, messages: ['nested message'] }
      ]
    })
    expect(client.session.children).toHaveBeenCalledTimes(4)
    expect(client.session.messages).toHaveBeenCalledTimes(3)
  })

  it('retains healthy sibling transcripts when one child message fetch fails', async () => {
    const client = {
      session: {
        children: vi.fn(async ({ sessionID }: { sessionID: string }) => ({
          data: sessionID === 'parent' ? [{ id: 'healthy' }, { id: 'broken' }] : []
        })),
        messages: vi.fn(async ({ sessionID }: { sessionID: string }) => {
          if (sessionID === 'broken') throw new Error('unavailable')
          return { data: [`${sessionID} message`] }
        })
      }
    } as unknown as OpencodeClient

    const result = await collectChildSessionTranscripts(client, 'parent', '/repo')
    expect(result.complete).toBe(false)
    expect(result.sessions).toEqual([
      { info: { id: 'healthy' }, messages: ['healthy message'] },
      { info: { id: 'broken' }, messages: [] }
    ])
  })

  it('discovers nested session ownership without fetching messages', async () => {
    const client = {
      session: {
        children: vi.fn(async ({ sessionID }: { sessionID: string }) => ({
          data: sessionID === 'parent'
            ? [{ id: 'child' }]
            : sessionID === 'child'
              ? [{ id: 'grandchild' }]
              : []
        }))
      }
    } as unknown as OpencodeClient

    const result = await collectChildSessionIds(client, 'parent', '/repo')
    expect([...result]).toEqual(['parent', 'child', 'grandchild'])
  })

  it('keeps direct ownership when another child tree lookup fails', async () => {
    const client = {
      session: {
        children: vi.fn(async ({ sessionID }: { sessionID: string }) => {
          if (sessionID === 'broken-root') throw new Error('unavailable')
          return { data: sessionID === 'healthy-root' ? [{ id: 'healthy-child' }] : [] }
        })
      }
    } as unknown as OpencodeClient

    const result = await buildSessionOwnerIndex(client, [
      { agentId: 'broken-agent', sessionId: 'broken-root' },
      { agentId: 'healthy-agent', sessionId: 'healthy-root' }
    ], '/repo')

    expect(result.owners.get('broken-root')).toBe('broken-agent')
    expect(result.owners.get('healthy-child')).toBe('healthy-agent')
    expect(result.incompleteAgentIds).toEqual(new Set(['broken-agent']))
  })

  it('returns empty groups so stale interrupt state can be pruned', () => {
    const grouped = groupRequestsByOwner(
      ['agent-a', 'agent-b'],
      new Map([['child-a', 'agent-a']]),
      [{ id: 'permission', sessionID: 'child-a' }]
    )

    expect(grouped).toEqual([
      { agentId: 'agent-a', requests: [{ id: 'permission', sessionID: 'child-a' }] },
      { agentId: 'agent-b', requests: [] }
    ])
  })
})
