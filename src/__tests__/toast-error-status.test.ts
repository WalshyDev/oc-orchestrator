// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { createDemoApi } from '../renderer/src/demoApi'
import { useAgentStore } from '../renderer/src/hooks/useAgentStore'
import type { OpenCodeEventPayload } from '../renderer/src/types/api'

it('blocks only a working agent on an error toast, and dismissing clears the block', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const api = createDemoApi()
  const base = { directory: '/tmp/project', projectName: 'project', prompt: '', title: 'Agent', labelIds: [] }
  api.listAgents = async () => ({
    ok: true,
    data: [
      { ...base, id: 'idle-agent', sessionId: 'idle-session', runtimeId: 'runtime-idle' },
      { ...base, id: 'busy-agent', sessionId: 'busy-session', runtimeId: 'runtime-busy' }
    ]
  })
  const statuses = {
    'idle-session': { agentId: 'idle-agent', status: { type: 'idle' } },
    'busy-session': { agentId: 'busy-agent', status: { type: 'busy' } }
  }
  api.getStatuses = async () => ({
    ok: true,
    data: statuses
  })
  api.getMessages = async () => ({ ok: true, data: [] })
  api.getChildSessions = async () => ({ ok: true, data: [] })
  api.getTodos = async () => ({ ok: true, data: [] })
  api.getConfig = async () => ({ ok: false, error: 'unused' })
  api.getProviders = async () => ({ ok: false, error: 'unused' })
  api.listQuestions = async () => ({ ok: true, data: [] })
  api.listPermissions = async () => ({ ok: true, data: [] })
  api.isAgentsRestored = async () => ({ ok: true, data: true })
  let onEvent: (payload: OpenCodeEventPayload) => void = () => {}
  api.onEvent = (callback) => {
    onEvent = callback
    return () => {}
  }
  window.api = api
  let store: ReturnType<typeof useAgentStore>
  let renderedSummary: string | undefined
  function Probe() {
    store = useAgentStore()
    renderedSummary = store.getEventsForSession('idle-session').at(-1)?.summary
    return null
  }
  const toast = (runtimeId: string, message = 'server failed'): OpenCodeEventPayload => ({
    runtimeId,
    directory: '/tmp/project',
    event: { type: 'tui.toast.show', properties: { variant: 'error', title: 'MCP', message } }
  })
  const agent = (id: string) => store!.agents.find((candidate) => candidate.id === id)!
  const root = createRoot(document.createElement('div'))
  try {
    await act(async () => root.render(createElement(Probe)))
    expect(agent('idle-agent').status).toBe('idle')
    expect(agent('busy-agent').status).toBe('running')

    await act(async () => onEvent(toast('runtime-idle')))
    expect(agent('idle-agent').status).toBe('idle')
    expect(renderedSummary).toBe('error toast: MCP: server failed')

    await act(async () => {
      onEvent({ runtimeId: 'runtime-idle', directory: '/tmp/project', event: {
        type: 'session.status', properties: { sessionID: 'idle-session', status: { type: 'busy' } }
      } })
      onEvent(toast('runtime-idle'))
    })
    expect(agent('idle-agent').status).toBe('needs_input')

    await act(async () => onEvent(toast('runtime-busy')))
    expect(agent('busy-agent').status).toBe('needs_input')

    await act(async () => store!.dismissAgentError('busy-agent'))
    expect(agent('busy-agent').status).toBe('running')
    statuses['busy-session'].status.type = 'idle'
    await act(async () => onEvent(toast('runtime-busy', 'another failure')))
    await act(async () => store!.dismissAgentError('busy-agent'))
    expect(agent('busy-agent').status).toBe('idle')

    await act(async () => {
      onEvent({ runtimeId: 'runtime-idle', directory: '/tmp/project', event: {
        type: 'question.asked', properties: {
          id: 'question-1', sessionID: 'idle-session', questions: [
            { header: 'Continue?', question: 'Continue?', options: [{ label: 'Yes', description: 'Continue' }] }
          ]
        }
      } })
    })
    await act(async () => store!.dismissAgentError('idle-agent'))
    expect(agent('idle-agent').status).toBe('needs_input')
    expect(store!.questions).toHaveLength(1)
  } finally {
    await act(async () => root.unmount())
    vi.unstubAllGlobals()
  }
})
