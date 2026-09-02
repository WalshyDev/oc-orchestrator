import { createElement, type MouseEvent as ReactMouseEvent, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { FleetTable, LastMessageCell } from '../renderer/src/components/FleetTable'
import { extractLastAssistantMessage, findLastTranscriptMessageId } from '../renderer/src/lib/last-message'
import type { AgentRuntime, Message } from '../renderer/src/types'

const messages: Message[] = [
  { id: 'user-1', role: 'user', content: 'Start', timestamp: 'now' },
  { id: 'assistant-1', role: 'assistant', content: 'First answer', timestamp: 'now' },
  { id: 'tools', role: 'tool-group', content: '1 tool call', timestamp: 'now' },
  { id: 'assistant-2', role: 'assistant', content: 'Latest answer', timestamp: 'now' }
]

describe('Fleet Last Message navigation', () => {
  const agent: AgentRuntime = {
    id: 'agent-1',
    sessionId: 'session-1',
    name: 'Agent 1',
    projectId: '/project',
    projectName: 'Project',
    branchName: 'feature',
    isWorktree: true,
    workspaceName: 'Workspace',
    taskSummary: 'Task',
    status: 'running',
    labelIds: [],
    model: 'model',
    prUrl: null,
    lastActivityAt: 'now',
    lastActivityAtMs: 1,
    lastMessage: 'Latest answer',
    currentTask: { status: 'in_progress', current: 2, total: 3, content: 'Add coverage' }
  }

  it('renders the last message as a keyboard-accessible button', () => {
    const markup = renderToStaticMarkup(LastMessageCell({
      agentId: agent.id,
      message: 'Latest answer',
      onSelect: () => {}
    }))

    expect(markup).toContain('<button')
    expect(markup).toContain('type="button"')
    expect(markup).toContain('Latest answer')
    expect(markup).toContain('Click to jump to this message')
  })

  it('jumps without triggering the row click', () => {
    const onSelect = vi.fn()
    const stopPropagation = vi.fn()
    const cell = LastMessageCell({ agentId: agent.id, message: 'Latest answer', onSelect })
    const button = cell.props.children as ReactElement<{
      onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void
    }>

    button.props.onClick({ stopPropagation } as unknown as ReactMouseEvent<HTMLButtonElement>)

    expect(stopPropagation).toHaveBeenCalledOnce()
    expect(onSelect).toHaveBeenCalledWith(agent.id, 'last-assistant-message')
  })

  it('keeps an empty Last Message cell non-interactive', () => {
    const markup = renderToStaticMarkup(LastMessageCell({ agentId: agent.id, onSelect: () => {} }))

    expect(markup).not.toContain('<button')
    expect(markup).toContain('--')
  })

  it('uses the interactive Last Message cell in the Fleet table', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {}
    })
    const markup = renderToStaticMarkup(createElement(FleetTable, {
      agents: [agent],
      selectedId: null,
      onSelect: () => {},
      visibleColumns: new Set(['lastMessage']),
      columnWidths: {}
    }))

    expect(markup).toContain('<button type="button"')
    expect(markup).toContain('Click to jump to this message')
  })

  it('aligns two-line task progress with the Last Message cell', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {}
    })
    const markup = renderToStaticMarkup(createElement(FleetTable, {
      agents: [agent],
      selectedId: null,
      onSelect: () => {},
      visibleColumns: new Set(['task', 'lastMessage']),
      columnWidths: {}
    }))

    expect(markup).toContain('Task 2/3: Add coverage')
    expect(markup).toContain('align-top')
    expect(markup).toContain('line-clamp-2')
  })

  it('shows completed task tracking with text and the success treatment', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {}
    })
    const markup = renderToStaticMarkup(createElement(FleetTable, {
      agents: [{ ...agent, currentTask: { status: 'completed', total: 1 } }],
      selectedId: null,
      onSelect: () => {},
      visibleColumns: new Set(['task']),
      columnWidths: {}
    }))

    expect(markup).toContain('All 1 task complete')
    expect(markup).toContain('text-kumo-success')
  })

  it('resolves the latest rendered assistant text message', () => {
    expect(findLastTranscriptMessageId(messages, 'last-assistant-message')).toBe('assistant-2')
    expect(findLastTranscriptMessageId([
      ...messages,
      { id: 'assistant-empty', role: 'assistant', content: '', timestamp: 'now' }
    ], 'last-assistant-message')).toBe('assistant-2')
  })

  it('does not display assistant text that the transcript hides', () => {
    expect(extractLastAssistantMessage([
      { role: 'assistant', parts: [{ type: 'text', text: 'Visible answer' }] },
      { role: 'assistant', parts: [{ type: 'text', text: 'Synthetic context', synthetic: true }] },
      { role: 'assistant', parts: [{ type: 'text', text: '   ' }] }
    ])).toBe('Visible answer')
  })
})
