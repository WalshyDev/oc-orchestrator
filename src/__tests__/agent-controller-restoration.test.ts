import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPreference: vi.fn(),
  setPreference: vi.fn(),
  ensureRuntime: vi.fn(),
  getRuntime: vi.fn()
}))

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../main/services/runtime-manager', () => ({
  runtimeManager: {
    ensureRuntime: mocks.ensureRuntime,
    getRuntime: mocks.getRuntime,
    touchRuntimeActivity: vi.fn()
  }
}))
vi.mock('../main/services/event-bridge', () => ({
  EventBridge: class {
    async start(): Promise<void> {}
    async ensureStreaming(): Promise<void> {}
  }
}))
vi.mock('../main/services/notification-service', () => ({ notificationService: {} }))
vi.mock('../main/services/database', () => ({
  database: { getPreference: mocks.getPreference, setPreference: mocks.setPreference }
}))
vi.mock('../main/services/workspace-manager', () => ({
  workspaceManager: {
    getDirectoryContext: (directory: string) => ({
      repoName: directory.split('/').pop(),
      branchName: 'main',
      isWorktree: false,
      workspaceName: directory.split('/').pop()
    })
  }
}))
vi.mock('../main/services/lease-registry', () => ({ leaseRegistry: {} }))

function persistedAgent(id: string, directory: string) {
  return {
    id, sessionId: `session-${id}`, directory, prompt: 'Investigate startup', title: id,
    displayName: 'Startup investigation', taskSummary: 'Keep the saved fleet',
    persistedStatus: 'completed', labelIds: ['in_review'],
    prUrl: 'https://github.com/example/repo/pull/1',
    modelOverride: { providerID: 'anthropic', modelID: 'claude-sonnet-4-6' },
    variantOverride: 'high', modelUpdatedAt: 123
  }
}

function runtimeFor(id: string, directory: string) {
  return {
    id,
    directory,
    client: {
      session: {
        messages: vi.fn().mockResolvedValue({ data: [] }),
        get: vi.fn().mockResolvedValue({ data: {} })
      }
    }
  }
}

async function loadController() {
  vi.resetModules()
  const { agentController } = await import('../main/services/agent-controller')
  return agentController
}

function lastPersistedIds(): string[] {
  const [, value] = mocks.setPreference.mock.calls.at(-1) ?? []
  return (JSON.parse(value ?? '[]') as Array<{ id: string }>).map((agent) => agent.id)
}

describe('AgentController restoration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getRuntime.mockReturnValue(undefined)
  })

  it.each([undefined, '[]'])('reports readiness with no persisted agents (%s)', async (preference) => {
    mocks.getPreference.mockReturnValue(preference)
    const agentController = await loadController()

    expect(agentController.restored).toBe(false)
    await agentController.restorePersistedAgents()

    expect(agentController.restored).toBe(true)
  })

  it('keeps agents whose runtime fails to start and reconnects them on use', async () => {
    mocks.getPreference.mockReturnValue(JSON.stringify([
      persistedAgent('agent-1', '/tmp/healthy'),
      persistedAgent('agent-2', '/tmp/broken')
    ]))
    const healthy = runtimeFor('runtime-1', '/tmp/healthy')
    mocks.ensureRuntime.mockImplementation(async (directory: string) => {
      if (directory === '/tmp/broken') throw new Error('Server exited with code 1')
      return healthy
    })
    const agentController = await loadController()

    await agentController.restorePersistedAgents()

    expect(agentController.restored).toBe(true)
    expect(agentController.getAllAgents().map((agent) => agent.id)).toEqual(['agent-1', 'agent-2'])
    expect(agentController.getAgent('agent-2')?.labelIds).toEqual(['in_review'])
    expect(lastPersistedIds()).toEqual(['agent-1', 'agent-2'])

    const recovered = runtimeFor('runtime-2', '/tmp/broken')
    mocks.ensureRuntime.mockResolvedValue(recovered)
    await agentController.getMessages('agent-2')

    expect(agentController.getAgent('agent-2')?.runtimeId).toBe('runtime-2')
    expect(recovered.client.session.messages).toHaveBeenCalled()
  })

  it('keeps the whole fleet when every runtime fails to start', async () => {
    mocks.getPreference.mockReturnValue(JSON.stringify([
      persistedAgent('agent-1', '/tmp/a'),
      persistedAgent('agent-2', '/tmp/b')
    ]))
    mocks.ensureRuntime.mockRejectedValue(new Error('opencode not found'))
    const agentController = await loadController()

    await agentController.restorePersistedAgents()

    expect(agentController.getAllAgents()).toHaveLength(2)
    expect(lastPersistedIds()).toEqual(['agent-1', 'agent-2'])
    const serialized = mocks.setPreference.mock.calls.at(-1)![1]
    const saved = JSON.parse(serialized)
    expect(saved).toEqual([
      persistedAgent('agent-1', '/tmp/a'),
      persistedAgent('agent-2', '/tmp/b')
    ])

    mocks.getPreference.mockReturnValue(serialized)
    const restartedController = await loadController()
    await restartedController.restorePersistedAgents()
    expect(JSON.parse(mocks.setPreference.mock.calls.at(-1)![1])).toEqual(saved)
    expect(restartedController.restored).toBe(true)
  })
})
