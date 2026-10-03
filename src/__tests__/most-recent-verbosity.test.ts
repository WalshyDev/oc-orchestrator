// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DetailDrawer } from '../renderer/src/components/DetailDrawer'
import { ToolsUsage, type ToolCall } from '../renderer/src/components/ToolsUsage'
import { EventLog, type EventEntry } from '../renderer/src/components/EventLog'
import { saveAgentOutputVerbosity } from '../renderer/src/data/agentSettings'
import { createDemoApi } from '../renderer/src/demoApi'
import type { AgentRuntime, Message } from '../renderer/src/types'

vi.mock('../renderer/src/hooks/useModelOptions', () => ({
  useModelOptions: () => ({ options: [], loading: false, providerData: {} })
}))

const agent: AgentRuntime = {
  id: 'agent', sessionId: 'session', name: 'Agent', projectId: 'project',
  projectName: 'Project', branchName: 'branch', isWorktree: true,
  workspaceName: 'workspace', taskSummary: 'Task', status: 'idle',
  labelIds: [], model: 'model', prUrl: null, lastActivityAt: 'now', lastActivityAtMs: 1
}

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
  window.api = createDemoApi()
  localStorage.clear()
  saveAgentOutputVerbosity('session', 'recent')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('Most recent output visibility', () => {
  it('follows agent output, ignores user messages and compaction, and permits one manual expansion', async () => {
    const messages: Message[] = [
      { id: 'old', role: 'assistant', content: '**Older response**', timestamp: 'now' },
      { id: 'latest', role: 'assistant', content: '**Latest response**', timestamp: 'now' }
    ]
    const render = async () => {
      await act(async () => root.render(createElement(DetailDrawer, { agent, messages: [...messages], onClose: () => {} })))
    }
    const expandedMessages = () => [...container.querySelectorAll('button[aria-label$="agent message"]')]
      .map((button) => button.getAttribute('aria-expanded'))

    await render()
    expect(expandedMessages()).toEqual(['false', 'true'])
    messages.push({ id: 'user', role: 'user', content: 'Follow up', timestamp: 'now' })
    messages.push({ id: 'compact', role: 'compaction', content: 'Compacted', timestamp: 'now' })
    await render()
    expect(expandedMessages()).toEqual(['false', 'true'])
    expect(container.textContent).toContain('Follow up')

    await act(async () => (container.querySelector('button[aria-label="Expand agent message"]') as HTMLButtonElement).click())
    expect(expandedMessages()).toEqual(['true', 'false'])
    messages[1] = { ...messages[1], content: '**Latest response continues streaming**' }
    await render()
    expect(expandedMessages()).toEqual(['true', 'false'])

    messages.push({
      id: 'tools', role: 'tool-group', content: 'Newest tools', timestamp: 'now',
      toolCalls: [{ id: 'read', name: 'read', state: 'running', input: '{"filePath":"new-file"}', timestamp: 1 }]
    })
    await render()
    expect(expandedMessages()).toEqual(['false', 'false'])
    expect(container.textContent).toContain('new-file')

    messages.push({ id: 'final', role: 'assistant', content: 'Final response', timestamp: 'now' })
    await render()
    expect(expandedMessages()).toEqual(['false', 'false', 'true'])
    expect(container.textContent).not.toContain('new-file')
  })

  it.each(['tools', 'events'] as const)('opens only the newest %s entry, including after updates and mode changes', async (kind) => {
    const entries = [
      { id: 'newer', timestamp: 2, name: 'read', state: 'running', input: 'newer input', type: 'tool', summary: 'Newer event', data: 'newer data' },
      { id: 'older', timestamp: 1, name: 'read', state: 'running', input: 'older input', type: 'tool', summary: 'Older event', data: 'older data' }
    ]
    const render = async (verbosity: 'recent' | 'all' = 'recent') => {
      await act(async () => root.render(kind === 'tools'
        ? createElement(ToolsUsage, { tools: [...entries] as ToolCall[], verbosity })
        : createElement(EventLog, { events: [...entries] as EventEntry[], verbosity })))
    }
    const details = () => [...container.querySelectorAll('pre')].map((element) =>
      kind === 'events' ? JSON.parse(element.textContent!) : element.textContent
    )
    const suffix = kind === 'tools' ? 'input' : 'data'

    await render()
    expect(details()).toEqual([`newer ${suffix}`])
    entries.push({ ...entries[0], id: 'newest', timestamp: 3, input: 'newest input', data: 'newest data' })
    await render()
    expect(details()).toEqual([`newest ${suffix}`])
    await render('all')
    expect(details()).toHaveLength(3)
    await render()
    expect(details()).toEqual([`newest ${suffix}`])
  })

  it('follows fresh output from an older running task in the Tools view', async () => {
    const tools: ToolCall[] = [
      { id: 'task', name: 'task', state: 'running', timestamp: 1, input: 'task input' },
      { id: 'read', name: 'read', state: 'completed', timestamp: 2, input: 'read input' }
    ]
    const render = async () => {
      await act(async () => root.render(createElement(ToolsUsage, { tools: [...tools], verbosity: 'recent' })))
    }
    await render()
    expect(container.querySelector('pre')?.textContent).toBe('read input')
    tools[0] = { ...tools[0], childActivityAt: 3 }
    await render()
    expect(container.querySelector('pre')?.textContent).toBe('task input')
    tools[0] = { ...tools[0], state: 'completed' }
    await render()
    expect(container.querySelector('pre')?.textContent).toBe('read input')
  })
})
