import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sessionCreate: vi.fn(),
  sessionCommand: vi.fn(),
  sessionStatus: vi.fn(),
  sessionTodo: vi.fn(),
  configUpdate: vi.fn(),
  touchRuntimeActivity: vi.fn(),
}))

const persistedAgents = [
  {
    id: 'agent-1',
    sessionId: 'existing-session',
    directory: '/tmp/project',
    prompt: '',
    title: 'Existing session',
    modelOverride: { providerID: 'openai', modelID: 'gpt-5.6-sol' },
    variantOverride: 'high',
  },
  {
    id: 'agent-2',
    sessionId: 'bare-model-session',
    directory: '/tmp/project',
    prompt: '',
    title: 'Bare model session',
    modelOverride: { providerID: '', modelID: 'local-model' },
  },
  {
    id: 'agent-3',
    sessionId: 'default-model-session',
    directory: '/tmp/project',
    prompt: '',
    title: 'Default model session',
  },
]

const runtime = {
  id: 'runtime-1',
  directory: '/tmp/project',
  client: {
    session: {
      create: mocks.sessionCreate,
      command: mocks.sessionCommand,
      status: mocks.sessionStatus,
      todo: mocks.sessionTodo,
    },
    config: {
      update: mocks.configUpdate,
    },
  },
}

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [],
  },
}))

vi.mock('../main/services/runtime-manager', () => ({
  runtimeManager: {
    ensureRuntime: vi.fn().mockResolvedValue(runtime),
    getRuntime: vi.fn().mockReturnValue(runtime),
    touchRuntimeActivity: mocks.touchRuntimeActivity,
  },
}))

vi.mock('../main/services/event-bridge', () => ({
  EventBridge: class {
    async start(): Promise<void> {}
    async ensureStreaming(): Promise<void> {}
  },
}))

vi.mock('../main/services/notification-service', () => ({
  notificationService: {},
}))

vi.mock('../main/services/database', () => ({
  database: {
    getPreference: () => JSON.stringify(persistedAgents),
    setPreference: vi.fn(),
  },
}))

vi.mock('../main/services/workspace-manager', () => ({
  workspaceManager: {
    getDirectoryContext: () => ({
      repoName: 'project',
      branchName: 'main',
      isWorktree: false,
      workspaceName: 'project',
    }),
  },
}))

vi.mock('../main/services/lease-registry', () => ({
  leaseRegistry: {},
}))

const { agentController } = await import('../main/services/agent-controller')

describe('AgentController.executeCommand', () => {
  beforeAll(async () => {
    await agentController.restorePersistedAgents()
  })

  beforeEach(() => {
    mocks.sessionCommand.mockReset()
    mocks.sessionCommand.mockResolvedValue({ data: undefined })
    mocks.sessionCreate.mockReset()
    mocks.sessionCreate.mockResolvedValue({ data: { id: 'new-session' } })
    mocks.sessionStatus.mockReset()
    mocks.sessionStatus.mockResolvedValue({ data: {} })
    mocks.sessionTodo.mockReset()
    mocks.sessionTodo.mockResolvedValue({ data: [] })
    mocks.configUpdate.mockReset()
    mocks.configUpdate.mockResolvedValue({ data: undefined })
  })

  it('uses the selected model for an existing session with an unavailable previous model', async () => {
    const unavailablePreviousModel = 'anthropic/claude-opus-5'
    mocks.sessionCommand.mockImplementation(async (request: { model?: string }) => {
      if ((request.model ?? unavailablePreviousModel) === unavailablePreviousModel) {
        throw new Error(`Model not found: ${unavailablePreviousModel}`)
      }
      return { data: undefined }
    })

    await agentController.executeCommand('agent-1', 'pull-request', '')

    expect(mocks.sessionCommand).toHaveBeenCalledWith({
      sessionID: 'existing-session',
      directory: '/tmp/project',
      command: 'pull-request',
      arguments: '',
      model: 'openai/gpt-5.6-sol',
      variant: 'high',
    })
  })

  it('preserves a bare selected model ID', async () => {
    await agentController.executeCommand('agent-2', 'review', 'src/main.ts')

    expect(mocks.sessionCommand).toHaveBeenCalledWith(expect.objectContaining({
      model: 'local-model',
    }))
  })

  it('changes one agent model without updating the shared directory config', async () => {
    await agentController.updateConfig('agent-3', {
      model: 'anthropic/claude-sonnet-4-6',
      variant: 'high',
    })
    await agentController.executeCommand('agent-3', 'review', '')
    await agentController.executeCommand('agent-2', 'review', '')

    expect(mocks.configUpdate).not.toHaveBeenCalled()
    expect(mocks.sessionCommand).toHaveBeenNthCalledWith(1, expect.objectContaining({
      model: 'anthropic/claude-sonnet-4-6',
      variant: 'high',
    }))
    expect(mocks.sessionCommand).toHaveBeenNthCalledWith(2, expect.objectContaining({
      model: 'local-model',
    }))
  })

  it('launches a selected model without updating the shared directory config', async () => {
    const handle = await agentController.launchAgent({
      directory: '/tmp/project',
      model: 'openai/gpt-5.6-sol',
      modelVariant: 'high',
    })

    expect(handle.modelOverride).toEqual({ providerID: 'openai', modelID: 'gpt-5.6-sol' })
    expect(handle.variantOverride).toBe('high')
    expect(mocks.configUpdate).not.toHaveBeenCalled()
  })

  it('keeps the previous override when another config update fails', async () => {
    mocks.configUpdate.mockRejectedValueOnce(new Error('config write failed'))

    await expect(agentController.updateConfig('agent-1', {
      model: 'anthropic/claude-opus-5',
      theme: 'dark',
    })).rejects.toThrow('config write failed')
    await agentController.executeCommand('agent-1', 'review', '')

    expect(mocks.sessionCommand).toHaveBeenCalledWith(expect.objectContaining({
      model: 'openai/gpt-5.6-sol',
      variant: 'high',
    }))
  })

  it('reports sessions omitted from a successful status snapshot as idle', async () => {
    mocks.sessionStatus.mockResolvedValue({
      data: {
        'existing-session': { type: 'busy' },
      },
    })

    const statuses = await agentController.getSessionStatuses()

    expect(statuses).toMatchObject({
      'existing-session': { agentId: 'agent-1', status: { type: 'busy' } },
      'bare-model-session': { agentId: 'agent-2', status: { type: 'idle' } },
      'default-model-session': { agentId: 'agent-3', status: { type: 'idle' } },
    })
  })

  it('fetches the persisted Todo list for an agent session', async () => {
    const todos = [{ content: 'Run checks', status: 'in_progress', priority: 'high' }]
    mocks.sessionTodo.mockResolvedValue({ data: todos })

    await expect(agentController.getTodos('agent-1')).resolves.toEqual(todos)
    expect(mocks.sessionTodo).toHaveBeenCalledWith({
      sessionID: 'existing-session',
      directory: '/tmp/project',
    })
  })
})
