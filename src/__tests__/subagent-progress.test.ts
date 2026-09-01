import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { shouldAutoExpandTool, ToolsUsage } from '../renderer/src/components/ToolsUsage'
import type { LiveMessage } from '../renderer/src/hooks/useAgentStore'
import {
  appendVisibleTextDelta,
  associateChildSessions,
  buildChildTranscript,
  getLatestChildActivityAt,
  getChildSessionId,
  getToolMetadataOutput,
  collectSessionSubtreeIds,
  mergeLiveMessagePart,
  orderTranscriptByActivity,
  type TaskPartDescriptor
} from '../renderer/src/lib/subagent-progress'
import { getPendingInterruptStatus } from '../renderer/src/lib/interrupt-status'
import type { Message } from '../renderer/src/types'

function assistantMessage(sessionId: string, parts: LiveMessage['parts'], updatedAt = 1): LiveMessage {
  return {
    id: `message-${sessionId}`,
    role: 'assistant',
    sessionId,
    createdAt: 1,
    updatedAt,
    parts
  }
}

describe('subagent progress', () => {
  it('reads the child and running output shapes emitted by OpenCode', () => {
    const state = {
      metadata: {
        parentSessionId: 'parent',
        sessionId: 'child',
        output: 'live command output'
      }
    }

    expect(getChildSessionId(state)).toBe('child')
    expect(getToolMetadataOutput(state)).toBe('live command output')
  })

  it('streams visible assistant text without exposing reasoning deltas', () => {
    const messages = [assistantMessage('child', [
      { id: 'text', type: 'text', text: '' },
      { id: 'reasoning', type: 'reasoning', text: '' }
    ])]

    expect(appendVisibleTextDelta(messages, messages[0].id, 'text', 'working')).toBe(true)
    expect(appendVisibleTextDelta(messages, messages[0].id, 'reasoning', 'hidden')).toBe(false)
    expect(messages[0].parts[0].text).toBe('working')
    expect(messages[0].parts[1].text).toBe('')
  })

  it('associates concurrent children by task title when events arrive out of order', () => {
    const first: TaskPartDescriptor = { toolInput: JSON.stringify({ description: 'First task' }) }
    const second: TaskPartDescriptor = { toolInput: JSON.stringify({ description: 'Second task' }) }

    associateChildSessions([first, second], [
      { id: 'second-child', parentID: 'parent', title: 'Second task (@explore subagent)' },
      { id: 'first-child', parentID: 'parent', title: 'First task (@general subagent)' }
    ], 'parent')

    expect(first.childSessionId).toBe('first-child')
    expect(second.childSessionId).toBe('second-child')
  })

  it('associates a child created before task metadata when the relationship is unambiguous', () => {
    const task: TaskPartDescriptor = {}
    associateChildSessions([task], [
      { id: 'early-child', parentID: 'parent' }
    ], 'parent')
    expect(task.childSessionId).toBe('early-child')
  })

  it('does not guess when child and task correlation data disagree', () => {
    const task: TaskPartDescriptor = {
      toolInput: JSON.stringify({ description: 'Expected task' })
    }
    associateChildSessions([task], [
      { id: 'wrong-child', parentID: 'parent', title: 'Different task (@explore subagent)' }
    ], 'parent')
    expect(task.childSessionId).toBeUndefined()
  })

  it('keeps newer streamed parts when an older hydration snapshot arrives', () => {
    const text = { id: 'text', type: 'text', text: 'complete streamed text' }
    mergeLiveMessagePart(text, { id: 'text', type: 'text', text: 'complete' })
    expect(text.text).toBe('complete streamed text')

    const tool = { id: 'tool', type: 'tool', toolState: 'completed', text: 'final output' }
    mergeLiveMessagePart(tool, { id: 'tool', type: 'tool', toolState: 'running', text: 'partial' })
    expect(tool).toMatchObject({ toolState: 'completed', text: 'final output' })
  })

  it('collects a deleted child session and all nested descendants', () => {
    const removed = collectSessionSubtreeIds([
      { id: 'child', parentID: 'parent' },
      { id: 'grandchild', parentID: 'child' },
      { id: 'sibling', parentID: 'parent' }
    ], 'child')
    expect([...removed]).toEqual(['child', 'grandchild'])
  })

  it('keeps agents blocked while any concurrent interrupt remains', () => {
    expect(getPendingInterruptStatus(
      'agent',
      [{ agentId: 'agent' }],
      [{ agentId: 'agent' }]
    )).toBe('needs_input')
    expect(getPendingInterruptStatus('agent', [{ agentId: 'agent' }], [])).toBe('needs_approval')
    expect(getPendingInterruptStatus('agent', [], [])).toBeUndefined()
  })

  it('builds assistant text, tool output, and nested subagent transcripts', () => {
    const messages = new Map<string, LiveMessage[]>([
      ['child', [assistantMessage('child', [
        {
          id: 'bash',
          type: 'tool',
          toolName: 'bash',
          toolState: 'running',
          toolInput: JSON.stringify({ command: 'npm test' }),
          text: 'tests are running'
        },
        {
          id: 'nested-task',
          type: 'tool',
          toolName: 'task',
          toolState: 'completed',
          childSessionId: 'grandchild'
        }
      ], 2)]],
      ['grandchild', [assistantMessage('grandchild', [
        { id: 'final', type: 'text', text: 'nested final output' }
      ], 3)]]
    ])

    const transcript = buildChildTranscript('child', (sessionId) => messages.get(sessionId) ?? [])

    expect(transcript[0]).toMatchObject({
      label: 'bash',
      toolState: 'running',
      toolSummary: 'npm test',
      toolOutput: 'tests are running'
    })
    expect(transcript[1].childTranscript?.[0]).toMatchObject({
      kind: 'text',
      label: 'nested final output'
    })
    expect(getLatestChildActivityAt(
      'child',
      (sessionId) => messages.get(sessionId) ?? [],
      (sessionId) => sessionId === 'child' ? 4 : undefined
    )).toBe(4)
  })

  it('places the most recently updated subagent at the bottom of the transcript', () => {
    const userMessage: Message = {
      id: 'user', role: 'user', content: 'continue', timestamp: 'now', activityAt: 15
    }
    const taskGroup: Message = {
      id: 'tasks', role: 'tool-group', content: '2 tool calls', timestamp: 'now', activityAt: 1,
      toolCalls: [{
        id: 'older', name: 'task', state: 'completed', timestamp: 1,
        childSessionId: 'older-child', childActivityAt: 10
      }, {
        id: 'newer', name: 'task', state: 'running', timestamp: 2,
        childSessionId: 'newer-child', childActivityAt: 20
      }]
    }

    expect(orderTranscriptByActivity([taskGroup, userMessage]).map((message) => message.id))
      .toEqual(['tasks-older', 'user', 'tasks-newer'])
  })

  it('expands running tasks immediately and keeps completed transcripts collapsible', () => {
    const running = renderToStaticMarkup(createElement(ToolsUsage, {
      tools: [{
        id: 'running',
        name: 'task',
        state: 'running',
        timestamp: Date.now()
      }]
    }))
    const completed = renderToStaticMarkup(createElement(ToolsUsage, {
      tools: [{
        id: 'completed',
        name: 'task',
        state: 'completed',
        timestamp: Date.now(),
        childSessionId: 'child',
        childTranscript: [{ id: 'final', kind: 'text', label: 'final child output' }]
      }]
    }))

    expect(running).toContain('sub-agent starting')
    expect(running).toContain('Creating child session...')
    expect(completed).not.toContain('final child output')
    expect(completed).toContain('Completed')
    expect(shouldAutoExpandTool({
      id: 'running',
      name: 'task',
      state: 'running',
      timestamp: 0
    }, false, true)).toBe(false)
  })
})
