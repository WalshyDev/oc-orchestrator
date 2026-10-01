import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DetailDrawer } from '../renderer/src/components/DetailDrawer'
import type { LivePermission, LiveQuestion } from '../renderer/src/hooks/useAgentStore'
import type { AgentRuntime } from '../renderer/src/types'

function getElementContents(markup: string, attribute: string): string {
  const attributeIndex = markup.indexOf(attribute)
  const openingTagStart = markup.lastIndexOf('<div', attributeIndex)
  const openingTagEnd = markup.indexOf('>', attributeIndex) + 1
  let depth = 1
  const tagPattern = /<\/?div\b[^>]*>/g
  tagPattern.lastIndex = openingTagEnd

  for (let match = tagPattern.exec(markup); match; match = tagPattern.exec(markup)) {
    depth += match[0].startsWith('</') ? -1 : 1
    if (depth === 0) return markup.slice(openingTagStart, match.index + match[0].length)
  }

  throw new Error(`Could not find closing div for ${attribute}`)
}

function createAgent(status: AgentRuntime['status']): AgentRuntime {
  return {
    id: 'agent-1',
    sessionId: 'session-1',
    name: 'Agent 1',
    projectId: 'project-1',
    projectName: 'Project',
    branchName: 'branch',
    isWorktree: true,
    workspaceName: 'workspace',
    taskSummary: 'Task',
    status,
    labelIds: [],
    model: 'model',
    prUrl: null,
    lastActivityAt: 'now',
    lastActivityAtMs: 1
  }
}

describe('DetailDrawer pending interrupts', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each<{
    name: string
    status: AgentRuntime['status']
    permission?: LivePermission
    question?: LiveQuestion
    expected: string
  }>([
    {
      name: 'structured question',
      status: 'needs_input',
      expected: 'Which findings should I fix?',
      question: {
        id: 'question-1',
        agentId: 'agent-1',
        sessionId: 'session-1',
        createdAt: 1,
        questions: [{
          header: 'Fix selection',
          question: 'Which findings should I fix?',
          options: [{ label: 'First', description: 'Fix the first finding.' }]
        }]
      }
    },
    {
      name: 'permission request',
      status: 'needs_approval',
      expected: 'Permission Request',
      permission: {
        id: 'permission-1',
        agentId: 'agent-1',
        sessionId: 'session-1',
        type: 'bash',
        title: 'Run tests',
        createdAt: 1
      }
    },
    {
      name: 'question fallback',
      status: 'needs_input',
      expected: 'Waiting for your response'
    }
  ])('keeps $name in the transcript scroll flow', ({ status, permission, question, expected }) => {
    vi.stubGlobal('window', { innerHeight: 1000 })
    vi.stubGlobal('localStorage', { getItem: () => null })

    const agent = createAgent(status)
    const markup = renderToStaticMarkup(createElement(DetailDrawer, {
      agent,
      messages: [{
        id: 'task-1',
        role: 'tool-group',
        content: '1 tool call',
        timestamp: 'now',
        toolCalls: [{
          id: 'tool-1',
          name: 'task',
          state: 'running',
          timestamp: 1,
          childTranscript: [{ id: 'child-1', kind: 'text', label: 'Working' }]
        }]
      }],
      permission,
      question,
      onClose: () => {}
    }))

    const transcript = getElementContents(markup, 'data-transcript-scroll')
    const interrupt = getElementContents(markup, 'data-pending-interrupt')
    expect(transcript).toContain(expected)
    expect(transcript).toContain(interrupt)
    expect(interrupt).toContain(expected)
    expect(interrupt).not.toContain('max-h-[45%]')
    expect(interrupt).not.toContain('overflow-y-auto')

    if (question) {
      expect(markup).toContain('placeholder="Type your answer to the question above..."')
    }
  })

  it('does not claim a stalled response asked a question', () => {
    vi.stubGlobal('window', { innerHeight: 1000 })
    vi.stubGlobal('localStorage', { getItem: () => null })

    const agent: AgentRuntime = {
      ...createAgent('needs_input'),
      lastActivityAt: '5m ago',
      inputReason: 'error',
      lastError: {
        name: 'StalledResponse',
        message: 'No update from provider for 5 minutes.',
        sessionId: 'session-1',
        occurredAt: 1
      }
    }

    const markup = renderToStaticMarkup(createElement(DetailDrawer, {
      agent,
      messages: [],
      onClose: () => {}
    }))

    expect(markup).toContain('StalledResponse')
    expect(markup).not.toContain('Waiting for your response')
    expect(markup).not.toContain('data-pending-interrupt')

    const dismissedMarkup = renderToStaticMarkup(createElement(DetailDrawer, {
      agent: { ...agent, lastError: undefined },
      messages: [],
      onClose: () => {}
    }))
    expect(dismissedMarkup).not.toContain('Waiting for your response')
    expect(dismissedMarkup).not.toContain('data-pending-interrupt')
  })

  it('shows retry reasons and tool waits in quiet diagnostics below the transcript', () => {
    vi.stubGlobal('window', { innerHeight: 1000 })
    vi.stubGlobal('localStorage', { getItem: () => null })
    const agent = { ...createAgent('running'), variant: 'high', lastActivityAtMs: Date.now() - 120_000 }
    const render = (overrides: Partial<Parameters<typeof DetailDrawer>[0]> = {}): string => renderToStaticMarkup(createElement(DetailDrawer, {
      agent,
      workspacePath: '/worktrees/project',
      messages: [],
      onClose: () => {},
      ...overrides
    }))
    const retryMarkup = render({ agent: { ...agent, retry: { attempt: 3, message: '429 Too Many Requests', next: Date.now() + 30_000 } } })
    const transcript = getElementContents(retryMarkup, 'data-transcript-scroll')
    const diagnostics = getElementContents(retryMarkup, 'data-agent-diagnostics')
    expect(transcript).not.toContain(diagnostics)
    expect(retryMarkup.indexOf(diagnostics)).toBeGreaterThan(retryMarkup.indexOf(transcript) + transcript.length)
    expect(diagnostics).toContain('text-kumo-subtle')
    expect(diagnostics).not.toMatch(/border|animate-/)
    expect(diagnostics).toContain('<details class="group">')
    expect(diagnostics).not.toMatch(/<details[^>]*\bopen(?:[\s=>])/)
    expect(diagnostics).toContain('Diagnostics <svg')
    expect(diagnostics).toContain('Workspace: /worktrees/project')
    expect(diagnostics).toContain('<div class="break-all">Session: session-1</div>')
    expect(diagnostics).toContain('<div class="break-all">Model: model</div>')
    expect(diagnostics).toContain('<div class="break-all">Variant: high</div>')
    expect(diagnostics).toContain(`dateTime="${new Date(agent.lastActivityAtMs).toISOString()}"`)
    expect(diagnostics).toContain('Last update:')
    expect(diagnostics).toContain('Provider retry #3')
    expect(retryMarkup).not.toContain('data-agent-activity')
    expect(retryMarkup).toContain('429 Too Many Requests')
    expect(retryMarkup).toContain('Next attempt in 30s')
    const toolMarkup = render({ messages: [{
      id: 'tools', role: 'tool-group', content: '', timestamp: 'now',
      toolCalls: [{ id: 'bash', name: 'bash', state: 'running', timestamp: Date.now() - 120_000 }]
    }] })
    expect(toolMarkup).toContain('Waiting for bash')
    expect(toolMarkup).not.toContain('No tool is running')
    const quietMarkup = render()
    expect(quietMarkup).toContain('Waiting for model output')
    expect(quietMarkup).toContain('OpenCode has not reported a cause')
    expect(quietMarkup).not.toContain('Agent is thinking')
  })

  it.each([
    ['idle', 'Idle'],
    ['completed', 'Completed'],
    ['errored', 'Errored'],
    ['disconnected', 'Disconnected']
  ] as const)('keeps %s diagnostics visible without stale running activity', (status, label) => {
    vi.stubGlobal('window', { innerHeight: 1000 })
    vi.stubGlobal('localStorage', { getItem: () => null })
    const markup = renderToStaticMarkup(createElement(DetailDrawer, {
      agent: { ...createAgent(status), retry: { attempt: 1, message: 'Provider overloaded', next: Date.now() } },
      workspacePath: '/worktrees/project',
      messages: [{
        id: 'tools', role: 'tool-group', content: '', timestamp: 'now',
        toolCalls: [{ id: 'bash', name: 'bash', state: 'running', timestamp: 1 }]
      }],
      onClose: () => {}
    }))
    const diagnostics = getElementContents(markup, 'data-agent-diagnostics')
    expect(diagnostics).toContain(`<div>${label}</div>`)
    expect(diagnostics).toContain('Workspace: /worktrees/project')
    expect(diagnostics).toContain('Last update:')
    expect(diagnostics).not.toMatch(/Provider retry|Provider overloaded|Waiting for|bash running/)
    expect(diagnostics).not.toContain('Variant:')
  })
})
