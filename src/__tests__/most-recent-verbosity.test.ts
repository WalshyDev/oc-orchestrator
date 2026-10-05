// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DetailDrawer, ToolGroupBubble } from '../renderer/src/components/DetailDrawer'
import { CollapsibleSubagentProgress, ToolsUsage, type ToolCall } from '../renderer/src/components/ToolsUsage'
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
  it.each(['tools', 'subagent'] as const)('keeps running %s details collapsed at None across state and visibility changes', async (kind) => {
    let tool: ToolCall = {
      id: 'task', name: 'task', state: 'running', timestamp: 1,
      input: 'task input', childTranscript: [{ id: 'child', kind: 'tool', label: 'bash', toolState: 'running', toolOutput: 'live child output' }]
    }
    const render = async (verbosity: 'none' | 'all' = 'none') => {
      await act(async () => root.render(kind === 'tools'
        ? createElement(ToolsUsage, { tools: [tool], verbosity })
        : createElement(CollapsibleSubagentProgress, { tool, verbosity })))
    }
    await render()
    expect(container.querySelector('pre')).toBeNull()
    await render('all')
    expect(container.textContent).toContain('live child output')
    await render()
    expect(container.querySelector('pre')).toBeNull()
    tool = { ...tool, state: 'completed' }
    await render()
    tool = { ...tool, state: 'running' }
    await render()
    expect(container.querySelector('pre')).toBeNull()

    await act(async () => container.querySelector('button[aria-expanded]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    if (kind === 'tools') {
      expect(container.textContent).toContain('task input')
      expect(container.textContent).not.toContain('live child output')
    } else {
      expect(container.textContent).toContain('live child output')
    }
  })

  it('keeps agent messages expanded while following tool output', async () => {
    const messages: Message[] = [
      { id: 'old', role: 'assistant', content: '**Older response**', timestamp: 'now' },
      { id: 'latest', role: 'assistant', content: '**Latest response**', timestamp: 'now' }
    ]
    const render = async () => {
      await act(async () => root.render(createElement(DetailDrawer, { agent, messages: [...messages], onClose: () => {} })))
    }
    const agentMessages = () => [...container.querySelectorAll('.markdown-body')]
      .map((element) => element.textContent)

    await render()
    expect(agentMessages()).toEqual(['Older response', 'Latest response'])
    expect(container.querySelector('button[aria-label$="agent message"]')).toBeNull()
    messages.push({ id: 'user', role: 'user', content: 'Follow up', timestamp: 'now' })
    messages.push({ id: 'compact', role: 'compaction', content: 'Compacted', timestamp: 'now' })
    await render()
    expect(agentMessages()).toEqual(['Older response', 'Latest response'])
    expect(container.textContent).toContain('Follow up')

    messages[1] = { ...messages[1], content: '**Latest response continues streaming**' }
    await render()
    expect(agentMessages()).toEqual(['Older response', 'Latest response continues streaming'])

    messages.push({
      id: 'tools', role: 'tool-group', content: 'Newest tools', timestamp: 'now',
      toolCalls: [{ id: 'read', name: 'read', state: 'running', input: '{"filePath":"new-file"}', timestamp: 1 }]
    })
    await render()
    expect(agentMessages()).toEqual(['Older response', 'Latest response continues streaming'])
    expect(container.textContent).toContain('new-file')

    const toolButton = container.querySelector('button[aria-expanded]') as HTMLButtonElement
    await act(async () => toolButton.click())
    expect(container.querySelector('pre')).toBeNull()
    await act(async () => toolButton.click())
    expect(container.querySelector('pre')?.textContent).toContain('new-file')

    messages.push({ id: 'final', role: 'assistant', content: 'Final response', timestamp: 'now' })
    await render()
    expect(agentMessages()).toEqual(['Older response', 'Latest response continues streaming', 'Final response'])
    expect(container.querySelector('pre')).toBeNull()
    expect(container.querySelector('[role="status"]')?.textContent).toContain('new-file')
  })

  it.each(['none', 'some', 'recent'] as const)('updates collapsed task activity in place at %s visibility', async (verbosity) => {
    let tool: ToolCall = {
      id: 'task', name: 'task', state: 'running', timestamp: 1,
      input: JSON.stringify({ description: 'Check the build' })
    }
    const render = async () => {
      await act(async () => root.render(createElement(ToolGroupBubble, {
        message: { id: 'tools', role: 'tool-group', content: '1 tool call', timestamp: 'now', toolCalls: [tool] },
        verbosity,
        recentExpanded: false
      })))
    }
    const updateNestedActivity = async (command: string) => {
      tool = { ...tool, childTranscript: [{
        id: 'nested', kind: 'tool', label: 'task', toolState: 'running', toolSummary: 'Run checks',
        childTranscript: [{ id: 'command', kind: 'tool', label: 'bash', toolState: 'running', toolSummary: command }]
      }] }
      await render()
    }

    await render()
    const button = container.querySelector('button')!
    if (verbosity === 'none') await act(async () => button.click())
    if (verbosity !== 'recent') await act(async () => button.click())
    const status = container.querySelector('[role="status"]')!
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.contains(status)).toBe(false)
    expect(status.getAttribute('aria-atomic')).toBe('true')
    expect(status.textContent).toContain('Runningtask · Check the build')

    await updateNestedActivity('$ npm run build')
    expect(container.querySelector('[role="status"]')).toBe(status)
    expect(status.textContent).toContain('task · bash · $ npm run build')
    await updateNestedActivity('$ npm run lint')
    expect(status.textContent).toContain('task · bash · $ npm run lint')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('pre')).toBeNull()

    tool = { ...tool, state: 'completed' }
    await render()
    expect(status.textContent).toContain('Completedtask · Check the build')
    expect(status.querySelector('.animate-spin')).toBeNull()
    tool = { ...tool, state: 'running' }
    await render()
    expect(button.getAttribute('aria-expanded')).toBe('false')
    tool = { ...tool, state: 'failed' }
    await render()
    expect(status.textContent).toContain('Failed')
    expect(status.querySelector('.animate-spin')).toBeNull()
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
