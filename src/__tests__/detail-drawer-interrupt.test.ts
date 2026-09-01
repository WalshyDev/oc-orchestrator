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
  ])('keeps $name outside the resizable transcript', ({ status, permission, question, expected }) => {
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
    expect(transcript).not.toContain(expected)
    expect(interrupt).toContain(expected)
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
})
