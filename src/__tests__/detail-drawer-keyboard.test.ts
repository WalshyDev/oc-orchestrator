// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { DetailDrawer } from '../renderer/src/components/DetailDrawer'
import { createDemoApi } from '../renderer/src/demoApi'
import type { AgentRuntime } from '../renderer/src/types'

it.each(['Keep this draft\nwith another line', '/rev', '@rev'])(
  'closes the drawer on Escape and restores draft %j when reopened', async (draft) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    })
    vi.stubGlobal('requestAnimationFrame', () => 0)
    vi.stubGlobal('cancelAnimationFrame', () => {})
    const previousApi = window.api
    window.api = createDemoApi()
    const agent: AgentRuntime = {
      id: `escape-agent-${draft}`, name: 'Agent', projectId: 'project',
      projectName: 'Project', branchName: 'branch', isWorktree: true,
      workspaceName: 'workspace', taskSummary: 'Task', status: 'idle',
      labelIds: [], model: 'model', prUrl: null, lastActivityAt: 'now', lastActivityAtMs: 1
    }
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const onClose = vi.fn(() => root.render(null))
    const onSendMessage = vi.fn()
    const render = async () => {
      await act(async () => root.render(createElement(DetailDrawer, {
        agent, messages: [], onClose, onSendMessage,
        commands: [{ command: '/review', description: 'Review changes' }],
        agentConfigs: [{ name: 'reviewer', description: 'Review changes' }]
      })))
    }

    try {
      await render()
      const textarea = host.querySelector('textarea')!
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, draft)
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
      })
      textarea.focus()
      const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      await act(async () => textarea.dispatchEvent(escape))
      expect(onClose).toHaveBeenCalledOnce()
      expect(host.querySelector('textarea')).toBeNull()
      expect(onSendMessage).not.toHaveBeenCalled()
      expect(escape.defaultPrevented).toBe(true)

      await render()
      expect(host.querySelector('textarea')!.value).toBe(draft)
    } finally {
      await act(async () => root.unmount())
      host.remove()
      window.api = previousApi
      vi.unstubAllGlobals()
    }
  }
)
