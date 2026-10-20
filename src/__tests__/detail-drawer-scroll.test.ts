// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { DetailDrawer } from '../renderer/src/components/DetailDrawer'
import { saveAgentOutputVerbosity } from '../renderer/src/data/agentSettings'
import { createDemoApi } from '../renderer/src/demoApi'
import type { AgentRuntime, Message } from '../renderer/src/types'

it('follows a rolling window of collapsed tools until the user scrolls away', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
  vi.stubGlobal('cancelAnimationFrame', () => {})
  const flushFrames = () => {
    while (frames.length) frames.shift()!(0)
  }
  const previousApi = window.api
  window.api = createDemoApi()
  localStorage.clear()
  saveAgentOutputVerbosity('scroll-session', 'none')
  const agent: AgentRuntime = {
    id: 'scroll-agent', sessionId: 'scroll-session', name: 'Agent', projectId: 'project',
    projectName: 'Project', branchName: 'branch', isWorktree: true,
    workspaceName: 'workspace', taskSummary: 'Task', status: 'running',
    labelIds: [], model: 'model', prUrl: null, lastActivityAt: 'now', lastActivityAtMs: 1
  }
  const toolMessage = (index: number): Message => ({
    id: `message-${index}`, role: 'tool-group', content: '1 tool call', timestamp: 'now',
    toolCalls: [{ id: `tool-${index}`, name: 'bash', state: 'completed', timestamp: index }]
  })
  let messages = Array.from({ length: 110 }, (_, index) => toolMessage(index))
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const render = async () => {
    await act(async () => root.render(createElement(DetailDrawer, {
      agent, messages, onClose: () => {}
    })))
    await act(async () => flushFrames())
  }

  try {
    await render()
    const scroll = host.querySelector<HTMLDivElement>('[data-transcript-scroll]')!
    let scrollTop = 1600
    Object.defineProperties(scroll, {
      clientHeight: { value: 400 },
      scrollHeight: { value: 2000 },
      scrollTop: {
        get: () => scrollTop,
        set: (value: number) => { scrollTop = Math.max(0, Math.min(value, 1600)) }
      }
    })

    // Browser anchoring shifts the viewport as equally tall cards leave the top
    scrollTop -= 67
    messages = [...messages, toolMessage(110)]
    await render()
    expect(scrollTop).toBe(1600)
    expect(host.textContent).not.toContain('Jump to latest')

    scrollTop = 900
    await act(async () => {
      scroll.dispatchEvent(new WheelEvent('wheel', { deltaY: -700 }))
      flushFrames()
    })
    scrollTop -= 67
    messages = [...messages, toolMessage(111)]
    await render()
    expect(scrollTop).toBe(833)
    const jump = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Jump to latest'))!
    expect(jump).toBeDefined()

    await act(async () => jump.click())
    expect(scrollTop).toBe(1600)
    scrollTop -= 67
    messages = [...messages, toolMessage(112)]
    await render()
    expect(scrollTop).toBe(1600)
    expect(host.textContent).not.toContain('Jump to latest')
  } finally {
    await act(async () => root.unmount())
    host.remove()
    localStorage.clear()
    window.api = previousApi
    vi.unstubAllGlobals()
  }
})
