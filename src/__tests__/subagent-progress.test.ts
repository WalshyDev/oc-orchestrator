import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ToolGroupBubble } from '../renderer/src/components/DetailDrawer'
import { SubagentProgress } from '../renderer/src/components/SubagentProgress'
import {
  shouldAutoExpandTool,
  ToolsUsage,
  type ToolCall
} from '../renderer/src/components/ToolsUsage'
import type { LiveMessage } from '../renderer/src/hooks/useAgentStore'
import {
  appendVisibleTextDelta,
  associateChildSessions,
  buildChildTranscript,
  getActiveAssistantMessage,
  getLatestChildActivityAt,
  getChildSessionId,
  getToolMetadataOutput,
  mapToolState,
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
    createdAt: updatedAt,
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

  it('keeps only the latest pending tool running when a session retries', () => {
    const messages = new Map<string, LiveMessage[]>([
      ['child', [
        assistantMessage('child', [{
          id: 'abandoned', type: 'tool', toolName: 'task', toolState: 'pending', childSessionId: 'abandoned-child'
        }]),
        assistantMessage('child', [{
          id: 'retry', type: 'tool', toolName: 'task', toolState: 'pending', childSessionId: 'retry-child'
        }], 2)
      ]],
      ['abandoned-child', [assistantMessage('abandoned-child', [
        { id: 'old-command', type: 'tool', toolName: 'bash', toolState: 'pending' }
      ])]],
      ['retry-child', [assistantMessage('retry-child', [
        { id: 'new-command', type: 'tool', toolName: 'bash', toolState: 'pending' }
      ])]]
    ])
    const getToolStates = (active: boolean) => {
      const transcript = buildChildTranscript('child', (sessionId) => messages.get(sessionId) ?? [], active)
      return transcript.map((entry) => [entry.toolState, entry.childTranscript?.[0].toolState])
    }

    expect(getToolStates(true))
      .toEqual([['failed', 'running'], ['running', 'running']])
    expect(getToolStates(false))
      .toEqual([['failed', 'running'], ['failed', 'running']])
  })

  it('keeps a pending Bash activity running when a later message arrives', () => {
    const messages = [
      assistantMessage('child', [{
        id: 'command', type: 'tool', toolName: 'bash', toolState: 'pending'
      }]),
      assistantMessage('child', [{ id: 'progress', type: 'text', text: 'Still working' }])
    ]

    const transcript = buildChildTranscript('child', () => messages)

    expect(transcript[0]).toMatchObject({ label: 'bash', toolState: 'running' })
  })

  it('keeps a Task running when the user queues a follow-up', () => {
    const task = assistantMessage('child', [{
      id: 'task', type: 'tool', toolName: 'task', toolState: 'pending', childSessionId: 'task-child'
    }])
    const followUp: LiveMessage = {
      id: 'follow-up',
      role: 'user',
      sessionId: 'child',
      createdAt: 2,
      parts: [{ id: 'text', type: 'text', text: 'Please also check the tests' }]
    }

    const transcript = buildChildTranscript('child', () => [task, followUp])

    expect(transcript[0]).toMatchObject({ label: 'task', toolState: 'running' })
  })

  it('selects the newest unfinished assistant by timestamp', () => {
    const older = { ...assistantMessage('child', []), id: 'older', createdAt: 10 }
    const newer = { ...assistantMessage('child', []), id: 'newer', createdAt: 20 }
    const followUp: LiveMessage = {
      id: 'follow-up',
      role: 'user',
      sessionId: 'child',
      createdAt: 30,
      parts: []
    }

    expect(getActiveAssistantMessage([newer, followUp, older])).toBe(newer)
  })

  it('does not reactivate a terminal assistant response', () => {
    const completed = { ...assistantMessage('child', []), completedAt: 2 }
    const errored = { ...assistantMessage('child', []), errored: true }

    expect(getActiveAssistantMessage([completed])).toBeUndefined()
    expect(getActiveAssistantMessage([errored])).toBeUndefined()
    expect(getActiveAssistantMessage([assistantMessage('child', [])], false)).toBeUndefined()
  })

  it('does not revive a completed Task when a new user message is optimistic', () => {
    const task = {
      ...assistantMessage('child', [{ id: 'task', type: 'tool', toolName: 'task', toolState: 'pending' }]),
      completedAt: 2
    }
    const followUp: LiveMessage = {
      id: 'follow-up',
      role: 'user',
      sessionId: 'child',
      createdAt: 3,
      parts: [{ id: 'text', type: 'text', text: 'Continue' }]
    }

    const transcript = buildChildTranscript('child', () => [task, followUp])

    expect(transcript[0]).toMatchObject({ label: 'task', toolState: 'failed' })
  })

  it('only infers failure for an inactive Task activity', () => {
    expect(mapToolState('bash', 'pending', false)).toBe('running')
    expect(mapToolState('task', 'pending', false)).toBe('failed')
  })

  it('explains when a task failed before creating its child session', () => {
    const markup = renderToStaticMarkup(createElement(SubagentProgress, {
      entries: [],
      state: 'failed'
    }))

    expect(markup).toContain('sub-agent failed')
    expect(markup).toContain('Child session was not created.')
    expect(markup).not.toContain('Creating child session...')
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

  it('moves running subagents by activity without moving completed tasks past later output', () => {
    const userMessage: Message = {
      id: 'user', role: 'user', content: 'continue', timestamp: 'now', activityAt: 15
    }
    const taskGroup: Message = {
      id: 'tasks', role: 'tool-group', content: '2 tool calls', timestamp: 'now', activityAt: 1,
      toolCalls: [{
        id: 'older', name: 'task', state: 'completed', timestamp: 1,
        childSessionId: 'older-child', childActivityAt: 30
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
    }, 'none', true)).toBe(false)
  })

  it('uses Some for parent output and All for completed subagent output', () => {
    const ordinaryTool = {
      id: 'bash',
      name: 'bash',
      state: 'completed' as const,
      timestamp: Date.now(),
      input: 'npm test',
      output: 'tests passed'
    }
    const completedTask = {
      id: 'task',
      name: 'task',
      state: 'completed' as const,
      timestamp: Date.now(),
      childSessionId: 'child',
      childTranscript: [{ id: 'final', kind: 'text' as const, label: 'final child output' }]
    }

    const someOrdinary = renderToStaticMarkup(createElement(ToolsUsage, {
      tools: [ordinaryTool],
      verbosity: 'some'
    }))
    const someTask = renderToStaticMarkup(createElement(ToolsUsage, {
      tools: [completedTask],
      verbosity: 'some'
    }))
    const allTask = renderToStaticMarkup(createElement(ToolsUsage, {
      tools: [completedTask],
      verbosity: 'all'
    }))

    expect(someOrdinary).toContain('tests passed')
    expect(someTask).not.toContain('final child output')
    expect(allTask).toContain('final child output')
    expect(shouldAutoExpandTool(ordinaryTool, 'some', false)).toBe(true)
    expect(shouldAutoExpandTool(completedTask, 'some', false)).toBe(false)
    expect(shouldAutoExpandTool(completedTask, 'all', false)).toBe(true)
  })

  it('shows completed Task results without treating child details as parent output', () => {
    const transcript = renderToStaticMarkup(createElement(ToolGroupBubble, {
      message: {
        id: 'task-result',
        role: 'tool-group',
        content: '1 tool call',
        timestamp: 'now',
        toolCalls: [{
          id: 'task',
          name: 'task',
          state: 'completed',
          timestamp: 1,
          output: '<task_result>Confirm this draft?</task_result>',
          childSessionId: 'child',
          childTranscript: [{ id: 'draft', kind: 'text', label: 'full child draft' }]
        }]
      },
      verbosity: 'some'
    }))

    expect(transcript).toContain('Confirm this draft?')
    expect(transcript).not.toContain('full child draft')
  })

  it('expands running commands after a completed todo update', () => {
    const tools: ToolCall[] = [{
      id: 'todo',
      name: 'todowrite',
      state: 'completed',
      timestamp: 1,
      input: JSON.stringify({ todos: [{ content: 'Run checks', status: 'in_progress' }] })
    }, {
      id: 'format',
      name: 'bash',
      state: 'running',
      timestamp: 2,
      input: JSON.stringify({ command: 'pnpm -w format:check' })
    }, {
      id: 'lint',
      name: 'bash',
      state: 'running',
      timestamp: 2,
      input: JSON.stringify({ command: 'pnpm -w lint' })
    }, {
      id: 'typecheck',
      name: 'bash',
      state: 'running',
      timestamp: 2,
      input: JSON.stringify({ command: 'pnpm -w type-check:go' })
    }]

    const toolsTab = renderToStaticMarkup(createElement(ToolsUsage, { tools }))
    const transcript = renderToStaticMarkup(createElement(ToolGroupBubble, {
      message: {
        id: 'tools',
        role: 'tool-group',
        content: '4 tool calls',
        timestamp: 'now',
        toolCalls: tools
      }
    }))

    expect(shouldAutoExpandTool(tools[0], 'none', false)).toBe(false)
    expect(shouldAutoExpandTool(tools[1], 'none', false)).toBe(true)
    for (const command of ['pnpm -w format:check', 'pnpm -w lint', 'pnpm -w type-check:go']) {
      expect(toolsTab).toContain(command)
      expect(transcript).toContain(command)
    }
  })
})
