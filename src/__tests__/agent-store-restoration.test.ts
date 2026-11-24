// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { createDemoApi } from '../renderer/src/demoApi'
import { useAgentStore } from '../renderer/src/hooks/useAgentStore'
import type { AgentLaunchedPayload, OpenCodeEventPayload } from '../renderer/src/types/api'

it('loads a restored agent transcript on selection after the first history read times out', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const api = createDemoApi()
  const base = {
    runtimeId: '', directory: '/tmp/project', projectName: 'project',
    prompt: 'Investigate startup', title: 'Startup', labelIds: ['in_review']
  }
  const agents = [undefined, 'running', 'completed', 'errored'].map((persistedStatus, index) => ({
    ...base, id: `restored-${index}`, sessionId: `restored-session-${index}`, persistedStatus
  }))
  const restored = agents[0]
  const savedMessages = [base.prompt, ...Array.from({ length: 11 }, (_, index) => `Saved message ${index + 1}`)]
  const history = savedMessages.map((text, index) => ({
    info: { id: `saved-${index}`, sessionID: restored.sessionId, role: index % 2 === 0 ? 'user' : 'assistant', time: { created: index + 1 } },
    parts: [{ id: `part-${index}`, type: 'text', text }]
  }))
  api.listAgents = async () => ({ ok: true, data: agents })
  api.getStatuses = async () => ({ ok: true, data: {} })
  const getMessages = vi.fn<typeof api.getMessages>().mockResolvedValue({ ok: false, error: 'Timeout waiting for server to start' })
  const sendMessage = vi.fn<typeof api.sendMessage>()
  api.getMessages = getMessages
  api.sendMessage = sendMessage
  api.getChildSessions = async () => ({ ok: false, error: 'Runtime unavailable' })
  api.getTodos = async () => ({ ok: false, error: 'Runtime unavailable' })
  api.getConfig = async () => ({ ok: false, error: 'Runtime unavailable' })
  api.getProviders = async () => ({ ok: false, error: 'Runtime unavailable' })
  api.listAllProviders = async () => ({ ok: true, data: { providers: [] } })
  api.listQuestions = async () => ({ ok: true, data: [] })
  api.listPermissions = async () => ({ ok: true, data: [] })
  api.isAgentsRestored = async () => ({ ok: true, data: true })
  let onLaunched: (payload: AgentLaunchedPayload) => void = () => {}
  api.onAgentLaunched = (callback) => {
    onLaunched = callback
    return () => {}
  }
  let onEvent: (payload: OpenCodeEventPayload) => void = () => {}
  api.onEvent = (callback) => {
    onEvent = callback
    return () => {}
  }
  let onReset: Parameters<typeof api.onSessionReset>[0] = () => {}
  api.onSessionReset = (callback) => {
    onReset = callback
    return () => {}
  }
  window.api = api
  let store: ReturnType<typeof useAgentStore>
  function Probe({ selectedAgentId }: { selectedAgentId?: string }) {
    store = useAgentStore(selectedAgentId)
    return null
  }
  const transcript = () => store.getMessagesForSession(restored.sessionId).flatMap((message) => message.parts.map((part) => part.text))
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(createElement(Probe)))
    expect(store!.initializing).toBe(false)
    expect(store!.agents.map((agent) => agent.status)).toEqual([
      'disconnected', 'disconnected', 'completed', 'errored'
    ])
    expect(transcript()).toEqual([base.prompt])

    vi.useFakeTimers()
    getMessages.mockClear()
    await act(async () => root.render(createElement(Probe, { selectedAgentId: restored.id })))
    expect(transcript()).toEqual([base.prompt])

    const recovered = Promise.withResolvers<Awaited<ReturnType<typeof getMessages>>>()
    getMessages.mockReturnValueOnce(recovered.promise)
    await act(async () => vi.advanceTimersByTimeAsync(1_000))

    const runtimeId = 'runtime-recovered'
    const last = history.at(-1)!
    const liveText = `${last.parts[0].text} with a live update`
    await act(async () => {
      onLaunched({ ...restored, runtimeId })
      window.dispatchEvent(new Event('focus'))
      onEvent({ runtimeId, event: { type: 'message.updated', properties: { info: last.info } } })
      onEvent({ runtimeId, event: { type: 'message.part.updated', properties: {
        part: { ...last.parts[0], sessionID: restored.sessionId, messageID: last.info.id, text: liveText }
      } } })
    })
    await act(async () => recovered.resolve({ ok: true, data: history }))
    expect(transcript()).toEqual([...savedMessages.slice(0, -1), liveText])
    expect(getMessages.mock.calls).toEqual([[restored.id], [restored.id]])
    expect(sendMessage).not.toHaveBeenCalled()
    expect(store!.agents[0].status).toBe('idle')
    expect(store!.agents[0].runtimeId).toBe(runtimeId)
    expect(store!.agents[0].labelIds).toEqual(['in_review'])

    const beforeReset = Promise.withResolvers<Awaited<ReturnType<typeof getMessages>>>()
    getMessages.mockClear().mockResolvedValue({ ok: true, data: [] }).mockReturnValueOnce(beforeReset.promise)
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(getMessages.mock.calls).toEqual([[restored.id]])
    expect(transcript()).toEqual([...savedMessages.slice(0, -1), liveText])

    await act(async () => onReset({ id: restored.id, sessionId: 'new-session', oldSessionId: restored.sessionId, branchName: '', prompt: '', title: '' }))
    await act(async () => beforeReset.resolve({ ok: true, data: history }))
    expect(transcript()).toEqual([])
  } finally {
    await act(async () => root.unmount())
    vi.useRealTimers()
    vi.unstubAllGlobals()
  }
})
