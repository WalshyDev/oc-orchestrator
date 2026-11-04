import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { OpenCodeEventPayload } from '../renderer/src/types/api'

const { cleanups } = vi.hoisted(() => ({ cleanups: [] as (() => void)[] }))

vi.mock('react', () => ({
  useCallback: (fn: unknown) => fn,
  useMemo: (fn: () => unknown) => fn(),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  useEffect: (effect: () => (() => void) | undefined) => {
    const cleanup = effect()
    if (cleanup) cleanups.push(cleanup)
  },
}))

vi.mock('../renderer/src/hooks/useModelOptions', () => ({
  ensureProvidersLoaded: vi.fn(),
  invalidateProviderCache: vi.fn(),
  lookupContextLimit: vi.fn(),
  resolveEffectiveVariant: vi.fn(),
  subscribeToContextLimits: () => () => {},
}))

let storage: Map<string, string>
let onEvent: (payload: OpenCodeEventPayload) => void
let onRestored: () => Promise<void>

function response(sessionID: string, modelID: string, created: number, parentID?: string) {
  return {
    info: { id: `${sessionID}-${created}`, sessionID, parentID, role: 'assistant', modelID, providerID: 'openai', time: { created } },
    parts: [],
  }
}

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) => setTimeout(() => callback(Date.now()), 0))
  storage = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  })
})

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('seeds parent history and records follow-up responses while excluding children and invoked agents', async () => {
  const parent = { id: 'parent', runtimeId: 'runtime', sessionId: 'parent-session', directory: '/project', title: 'Parent' }
  const history = [
    { info: { id: 'user-1', sessionID: 'parent-session', role: 'user', time: { created: 50 } }, parts: [] },
    { ...response('parent-session', 'a', 100, 'user-1'), parts: [{ id: 'step', type: 'step-start' }] },
    { info: { id: 'invoked-user', sessionID: 'parent-session', role: 'user', time: { created: 200 } }, parts: [] },
    response('parent-session', 'invoked-model', 300, 'invoked-user'),
    response('child-session', 'child-model', 400),
  ]
  const ok = (data: unknown = []) => Promise.resolve({ ok: true, data })
  const restored = vi.fn(() => ok(true))
  const api = new Proxy({
    listAgents: () => ok([parent]),
    getMessages: () => ok(history),
    getProviders: () => ok({ providers: [] }),
    isAgentsRestored: restored,
    getChildSessions: () => ok({ sessions: [{ info: { id: 'child-session', parentID: 'parent-session' }, messages: [response('child-session', 'child-model', 400)] }], complete: true }),
    onEvent: (listener: typeof onEvent) => { onEvent = listener; return () => {} },
    onAgentsRestored: (listener: typeof onRestored) => { onRestored = listener; return () => {} },
  }, {
    get(target, key) {
      if (key in target) return target[key as keyof typeof target]
      return String(key).startsWith('on') ? () => () => {} : () => ok()
    },
  })
  vi.stubGlobal('window', Object.assign(new EventTarget(), { api }))
  const { useAgentStore } = await import('../renderer/src/hooks/useAgentStore')
  useAgentStore()
  await vi.waitFor(() => expect(restored).toHaveBeenCalled())
  const models = () => JSON.parse(storage.get('oc-orchestrator:recent-models') ?? '[]').map((entry: { model: string }) => entry.model)
  expect(models()).toEqual(['openai/a'])

  const emitResponse = (session: string, model: string, created: number) => onEvent({
    runtimeId: 'runtime', event: { type: 'message.updated', properties: { info: response(session, model, created).info } },
  } as OpenCodeEventPayload)
  emitResponse('parent-session', 'invoked-model', 300)
  expect(models()).toEqual(['openai/a'])
  emitResponse('parent-session', 'b', 500)
  emitResponse('child-session', 'child-model', 600)
  emitResponse('parent-session', 'a', 700)
  emitResponse('parent-session', 'b', 500)
  expect(models()).toEqual(['openai/a', 'openai/b'])
  onEvent({ runtimeId: 'runtime', event: { type: 'message.part.updated', properties: {
    part: { id: 'nested-step', sessionID: 'parent-session', messageID: 'parent-session-700', type: 'step-start' },
  } } } as OpenCodeEventPayload)
  emitResponse('parent-session', 'live-invoked-model', 800)
  onEvent({ runtimeId: 'runtime', event: { type: 'session.idle', properties: { sessionID: 'parent-session' } } } as OpenCodeEventPayload)
  emitResponse('parent-session', 'live-invoked-model', 800)
  expect(models()).toEqual(['openai/a', 'openai/b'])
  history.push(response('parent-session', 'live-invoked-model', 800))
  await onRestored()
  expect(models()).toEqual(['openai/a', 'openai/b'])
})
