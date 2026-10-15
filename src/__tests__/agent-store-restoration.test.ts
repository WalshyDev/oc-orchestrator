// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { createDemoApi } from '../renderer/src/demoApi'
import { useAgentStore } from '../renderer/src/hooks/useAgentStore'
import type { AgentLaunchedPayload } from '../renderer/src/types/api'

it('shows failed restorations as disconnected and clears that status after reconnection', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const api = createDemoApi()
  const base = {
    runtimeId: '', directory: '/tmp/project', projectName: 'project',
    prompt: 'Investigate startup', title: 'Startup', labelIds: ['in_review']
  }
  const agents = [undefined, 'running', 'completed', 'errored'].map((persistedStatus, index) => ({
    ...base, id: `restored-${index}`, sessionId: `restored-session-${index}`, persistedStatus
  }))
  api.listAgents = async () => ({ ok: true, data: agents })
  api.getStatuses = async () => ({ ok: true, data: {} })
  api.getMessages = async () => ({ ok: false, error: 'Runtime unavailable' })
  api.getChildSessions = async () => ({ ok: false, error: 'Runtime unavailable' })
  api.getTodos = async () => ({ ok: false, error: 'Runtime unavailable' })
  api.getConfig = async () => ({ ok: false, error: 'Runtime unavailable' })
  api.getProviders = async () => ({ ok: false, error: 'Runtime unavailable' })
  api.listQuestions = async () => ({ ok: true, data: [] })
  api.listPermissions = async () => ({ ok: true, data: [] })
  api.isAgentsRestored = async () => ({ ok: true, data: true })
  let onLaunched: (payload: AgentLaunchedPayload) => void = () => {}
  api.onAgentLaunched = (callback) => {
    onLaunched = callback
    return () => {}
  }
  window.api = api
  let store: ReturnType<typeof useAgentStore>
  function Probe() {
    store = useAgentStore()
    return null
  }
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(createElement(Probe)))
    expect(store!.initializing).toBe(false)
    expect(store!.agents.map((agent) => agent.status)).toEqual([
      'disconnected', 'disconnected', 'completed', 'errored'
    ])
    await act(async () => onLaunched({ ...agents[0], runtimeId: 'runtime-recovered' }))
    expect(store!.agents[0].status).toBe('idle')
    expect(store!.agents[0].runtimeId).toBe('runtime-recovered')
    expect(store!.agents[0].labelIds).toEqual(['in_review'])
  } finally {
    await act(async () => root.unmount())
    vi.unstubAllGlobals()
  }
})
