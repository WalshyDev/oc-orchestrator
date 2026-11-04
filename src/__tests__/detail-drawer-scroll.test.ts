// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { DetailDrawer } from '../renderer/src/components/DetailDrawer'
import { saveAgentOutputVerbosity } from '../renderer/src/data/agentSettings'
import { createDemoApi } from '../renderer/src/demoApi'
import type { AgentRuntime, Message } from '../renderer/src/types'
import type { LiveQuestion } from '../renderer/src/hooks/useAgentStore'

it.each(['wheel', 'keyboard', 'scrollbar'])('follows collapsed tools until the user scrolls away with the %s', async (input) => {
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
  let question: LiveQuestion | undefined = {
    id: 'question', agentId: agent.id, sessionId: agent.sessionId!, createdAt: 1,
    questions: [{ question: 'Continue?', options: [{ label: 'Yes', description: 'Continue the task' }] }]
  }
  const onReplyQuestion = vi.fn(() => { question = undefined })
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const render = async () => {
    await act(async () => root.render(createElement(DetailDrawer, {
      agent, messages, question, onReplyQuestion, onClose: () => {}
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

    const answer = scroll.querySelector('input')!
    await act(async () => {
      answer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
      flushFrames()
    })
    const yes = [...scroll.querySelectorAll('button')].find(button => button.textContent?.includes('Yes'))!
    await act(async () => yes.click())
    const submit = [...scroll.querySelectorAll('button')].find(button => button.textContent?.includes('Submit'))!
    await act(async () => submit.click())
    expect(onReplyQuestion).toHaveBeenCalledWith([['Yes']])

    // Browser anchoring shifts the viewport as equally tall cards leave the top
    scrollTop -= 67
    messages = [...messages, toolMessage(110)]
    await render()
    expect(scrollTop).toBe(1600)
    expect(host.textContent).not.toContain('Jump to latest')

    await act(async () => {
      if (input === 'scrollbar') {
        const pointer = new MouseEvent('pointerdown')
        Object.defineProperty(pointer, 'offsetX', { value: scroll.clientWidth })
        scroll.dispatchEvent(pointer)
      } else if (input === 'keyboard') {
        scroll.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }))
      } else {
        scroll.dispatchEvent(new WheelEvent('wheel', { deltaY: -10 }))
      }
      scrollTop = 1590
      messages = [...messages, toolMessage(111)]
      root.render(createElement(DetailDrawer, { agent, messages, onClose: () => {} }))
    })
    expect(scrollTop).toBe(1590)
    if (input === 'scrollbar') {
      await act(async () => {
        scroll.dispatchEvent(new Event('scroll'))
        window.dispatchEvent(new MouseEvent('pointerup'))
      })
    }
    await act(async () => flushFrames())
    await act(async () => {
      scroll.dispatchEvent(new WheelEvent('wheel', { deltaX: 30, deltaY: 0 }))
      flushFrames()
    })
    scrollTop -= 10
    messages = [...messages, toolMessage(112)]
    await render()
    expect(scrollTop).toBe(1580)

    scrollTop = 1595
    await act(async () => {
      scroll.dispatchEvent(new WheelEvent('wheel', { deltaY: 15 }))
      flushFrames()
    })
    messages = [...messages, toolMessage(113)]
    await render()
    expect(scrollTop).toBe(1600)

    scrollTop = 900
    await act(async () => {
      scroll.dispatchEvent(new WheelEvent('wheel', { deltaY: -680 }))
      flushFrames()
    })
    scrollTop -= 67
    messages = [...messages, toolMessage(114)]
    await render()
    expect(scrollTop).toBe(833)
    const jump = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Jump to latest'))!
    expect(jump).toBeDefined()

    await act(async () => jump.click())
    expect(scrollTop).toBe(1600)
    scrollTop -= 67
    messages = [...messages, toolMessage(115)]
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
