import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  list: vi.fn(), messages: vi.fn(), create: vi.fn(), delete: vi.fn(),
  setPreference: vi.fn(), send: vi.fn(), ensureRuntime: vi.fn()
}))

const runtime = {
  id: 'runtime-home', directory: '/Users/example',
  client: { session: { list: mocks.list, messages: mocks.messages, create: mocks.create, delete: mocks.delete } }
}

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [{
  isDestroyed: () => false, webContents: { isDestroyed: () => false, send: mocks.send }
}] } }))
vi.mock('../main/services/runtime-manager', () => ({ runtimeManager: {
  ensureRuntime: mocks.ensureRuntime, touchRuntimeActivity: vi.fn(), stopRuntime: vi.fn()
} }))
vi.mock('../main/services/event-bridge', () => ({ EventBridge: class {
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
} }))
vi.mock('../main/services/notification-service', () => ({ notificationService: {} }))
vi.mock('../main/services/database', () => ({ database: {
  getPreference: () => undefined, setPreference: mocks.setPreference
} }))
vi.mock('../main/services/workspace-manager', () => ({ workspaceManager: {
  getDirectoryContext: () => ({ repoName: 'example', branchName: '', isWorktree: false, workspaceName: 'example' })
} }))
vi.mock('../main/services/lease-registry', () => ({ leaseRegistry: {} }))

let controller: typeof import('../main/services/agent-controller').agentController

beforeEach(async () => {
  vi.resetModules()
  vi.resetAllMocks()
  mocks.ensureRuntime.mockResolvedValue(runtime)
  mocks.messages.mockResolvedValue({ data: [] })
  controller = (await import('../main/services/agent-controller')).agentController
})

describe('session restoration', () => {
  it('finds a previously deleted QuickStart and restores the original session as a persisted fleet row', async () => {
    const options = { directory: '/Users/example', sessionId: 'ses_quick', title: 'QuickStart-random' }
    const original = await controller.resumeAgent(options)
    controller.removeAgent(original.id)
    mocks.list.mockResolvedValue({ data: [{ id: options.sessionId, title: options.title, directory: options.directory,
      time: { created: 100, updated: 200 } }] })
    const page = await controller.listSessions(options.directory)
    expect(page).toEqual({ hasMore: false, sessions: [{ id: 'ses_quick', title: options.title,
      directory: options.directory, createdAt: 100, updatedAt: 200 }] })

    const restored = await controller.resumeAgent(options)
    expect(restored.sessionId).toBe('ses_quick')
    expect(restored.directory).toBe('/Users/example')
    expect(controller.getAllAgents()).toEqual([restored])
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.delete).not.toHaveBeenCalled()
    expect(mocks.setPreference).toHaveBeenLastCalledWith('active_agents', expect.stringContaining('ses_quick'))
    expect(mocks.send).toHaveBeenLastCalledWith('agent:launched', expect.objectContaining({ id: restored.id, sessionId: 'ses_quick' }))
    expect((await controller.listSessions(options.directory)).sessions).toEqual([])
  })

  it('keeps load-more available even when the loaded page contains only fleet rows or subagents', async () => {
    await controller.resumeAgent({ directory: '/Users/example', sessionId: 'active' })
    mocks.list.mockResolvedValue({ data: [
      { id: 'active' }, { id: 'child', parentID: 'active' }, { id: 'older', directory: '/Users/example', title: 'Old task' }
    ] })
    expect(await controller.listSessions('/Users/example', 2)).toEqual({ sessions: [], hasMore: true })
    expect(mocks.list).toHaveBeenCalledWith({ directory: '/Users/example', roots: true, limit: 3 })
    expect((await controller.listSessions('/Users/example', 3)).sessions.map((session) => session.id)).toEqual(['older'])
  })

  it('reads the first real user prompt across message pages, excluding assistant and synthetic text', async () => {
    const recent = Array.from({ length: 100 }, (_, index) => ({
      info: { id: `msg_${String(index + 10).padStart(3, '0')}`, role: 'user' },
      parts: [{ type: 'text', text: 'Later follow-up' }]
    }))
    mocks.messages.mockResolvedValueOnce({ data: recent }).mockResolvedValueOnce({ data: [
      { info: { id: 'msg_001', role: 'assistant' }, parts: [{ type: 'text', text: 'Assistant text' }] },
      { info: { id: 'msg_002', role: 'user' }, parts: [{ type: 'text', text: 'Hidden', synthetic: true }] },
      { info: { id: 'msg_003', role: 'user' }, parts: [
        { type: 'text', text: 'Ignored', ignored: true }, { type: 'text', text: 'Investigate certificates' },
        { type: 'text', text: 'for this zone' }
      ] }
    ] })
    expect(await controller.getSessionFirstPrompt('/Users/example', 'ses_quick')).toBe('Investigate certificates\nfor this zone')
    expect(mocks.messages).toHaveBeenLastCalledWith(
      { directory: '/Users/example', sessionID: 'ses_quick', limit: 100, before: 'msg_010' },
      { signal: expect.any(AbortSignal) }
    )
  })

  it('reports failed reads and prevents a loop when a server ignores message pagination', async () => {
    mocks.list.mockResolvedValueOnce({ error: 'unavailable' })
    await expect(controller.listSessions('/Users/example')).rejects.toThrow('Failed to list sessions')
    mocks.messages.mockResolvedValueOnce({ error: 'unavailable' })
    await expect(controller.getSessionFirstPrompt('/Users/example', 'missing')).rejects.toThrow('Failed to read session preview')
    mocks.messages.mockResolvedValue({ data: Array.from({ length: 100 }, (_, index) => ({
      info: { id: `msg_${index}`, role: 'user' }, parts: []
    })) })
    await expect(controller.getSessionFirstPrompt('/Users/example', 'ses_quick')).rejects.toThrow('pagination did not advance')
  })

  it('bounds preview reads and reports incomplete history rather than presenting a later prompt as the first', async () => {
    let page = 0
    mocks.messages.mockImplementation(async () => {
      const pageId = page++
      return { data: Array.from({ length: 100 }, (_, index) => ({
        info: { id: `msg_${pageId}_${index}`, role: 'user' },
        parts: [{ type: 'text', text: 'A later prompt' }]
      })) }
    })
    await expect(controller.getSessionFirstPrompt('/Users/example', 'ses_long')).rejects.toThrow('Session is too long')
    expect(mocks.messages).toHaveBeenCalledTimes(50)
  })
})
