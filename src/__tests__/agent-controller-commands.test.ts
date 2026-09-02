import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sessionCreate: vi.fn(),
  sessionCommand: vi.fn(),
  sessionPromptAsync: vi.fn(),
  sessionStatus: vi.fn(),
  sessionTodo: vi.fn(),
  sessionAbort: vi.fn(),
  configUpdate: vi.fn(),
  touchRuntimeActivity: vi.fn(),
  sendToRenderer: vi.fn(),
  bridgeEvent: undefined as ((event: { type: string; properties: unknown }) => void) | undefined,
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
      promptAsync: mocks.sessionPromptAsync,
      status: mocks.sessionStatus,
      todo: mocks.sessionTodo,
      abort: mocks.sessionAbort,
    },
    config: {
      update: mocks.configUpdate,
    },
  },
}

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [{
      isDestroyed: () => false,
      webContents: { isDestroyed: () => false, send: mocks.sendToRenderer },
    }],
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
    constructor(
      _runtimeId: string,
      _directory: string,
      _client: unknown,
      onEvent?: (event: { type: string; properties: unknown }) => void
    ) {
      mocks.bridgeEvent = onEvent
    }
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
    mocks.sessionPromptAsync.mockReset()
    mocks.sessionPromptAsync.mockResolvedValue({ data: undefined })
    mocks.sessionCreate.mockReset()
    mocks.sessionCreate.mockResolvedValue({ data: { id: 'new-session' } })
    mocks.sessionStatus.mockReset()
    mocks.sessionStatus.mockResolvedValue({ data: {} })
    mocks.sessionTodo.mockReset()
    mocks.sessionTodo.mockResolvedValue({ data: [] })
    mocks.sessionAbort.mockReset()
    mocks.sessionAbort.mockResolvedValue({ data: undefined })
    mocks.configUpdate.mockReset()
    mocks.configUpdate.mockResolvedValue({ data: undefined })
    mocks.sendToRenderer.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
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
    expect(mocks.sendToRenderer).toHaveBeenCalledWith('agent:launched', expect.objectContaining({
      modelOverride: { providerID: 'openai', modelID: 'gpt-5.6-sol' },
      variantOverride: 'high',
    }))
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

  it('notifies the renderer when a direct prompt changes the model override', async () => {
    await agentController.sendMessageWithModel(
      'agent-1',
      'Use the new model',
      'anthropic',
      'claude-opus-5'
    )

    expect(mocks.sendToRenderer).toHaveBeenCalledWith('agent:model-changed', {
      id: 'agent-1',
      modelOverride: { providerID: 'anthropic', modelID: 'claude-opus-5' },
      variantOverride: 'high',
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

  it('aborts a running stalled request before sending the recovery prompt', async () => {
    mocks.sessionStatus
      .mockResolvedValueOnce({ data: { 'existing-session': { type: 'busy' } } })
      .mockResolvedValueOnce({ data: {} })

    const result = await agentController.recoverStalledAgent(
      'agent-1',
      'Continue from the stalled request.',
      Date.now()
    )

    expect(result).toBe('recovered')
    expect(mocks.sessionAbort).toHaveBeenCalledWith({
      sessionID: 'existing-session',
      directory: '/tmp/project',
    })
    expect(mocks.sessionPromptAsync).toHaveBeenCalledWith(expect.objectContaining({
      sessionID: 'existing-session',
      parts: [{ type: 'text', text: 'Continue from the stalled request.' }],
    }))
    expect(mocks.sessionAbort.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.sessionPromptAsync.mock.invocationCallOrder[0]
    )
  })

  it('lets a real prompt supersede recovery without aborting that prompt', async () => {
    let releaseAbort: (() => void) | undefined
    mocks.sessionAbort.mockImplementationOnce(() => new Promise<void>((resolve) => {
      releaseAbort = resolve
    }))

    mocks.sessionStatus.mockResolvedValueOnce({
      data: { 'existing-session': { type: 'busy' } }
    })
    const recovery = agentController.recoverStalledAgent(
      'agent-1',
      'Synthetic recovery prompt',
      Date.now()
    )
    await vi.waitFor(() => expect(mocks.sessionAbort).toHaveBeenCalledOnce())

    const realPrompt = agentController.sendMessage('agent-1', 'Real user prompt')
    expect(mocks.sessionPromptAsync).not.toHaveBeenCalled()
    releaseAbort?.()

    await expect(recovery).resolves.toBe('superseded')
    await realPrompt
    expect(mocks.sessionPromptAsync).toHaveBeenCalledOnce()
    expect(mocks.sessionPromptAsync).toHaveBeenCalledWith(expect.objectContaining({
      parts: [{ type: 'text', text: 'Real user prompt' }],
    }))
  })

  it('cancels recovery while checking session status', async () => {
    let releaseStatus: (() => void) | undefined
    mocks.sessionStatus.mockImplementationOnce(() => new Promise((resolve) => {
      releaseStatus = () => resolve({ data: { 'existing-session': { type: 'busy' } } })
    }))

    const recovery = agentController.recoverStalledAgent('agent-1', 'Synthetic recovery prompt', Date.now())
    await vi.waitFor(() => expect(mocks.sessionStatus).toHaveBeenCalledOnce())

    const realPrompt = agentController.sendMessage('agent-1', 'Real user prompt')
    expect(mocks.sessionPromptAsync).not.toHaveBeenCalled()
    releaseStatus?.()

    await expect(recovery).resolves.toBe('superseded')
    await realPrompt
    expect(mocks.sessionAbort).not.toHaveBeenCalled()
    expect(mocks.sessionPromptAsync).toHaveBeenCalledOnce()
  })

  it('does not abort when provider activity arrives during the recovery check', async () => {
    let releaseStatus: (() => void) | undefined
    mocks.sessionStatus.mockImplementationOnce(() => new Promise((resolve) => {
      releaseStatus = () => resolve({ data: { 'existing-session': { type: 'busy' } } })
    }))

    const recovery = agentController.recoverStalledAgent('agent-1', 'Synthetic recovery prompt', Date.now())
    await vi.waitFor(() => expect(mocks.sessionStatus).toHaveBeenCalledOnce())
    mocks.bridgeEvent?.({
      type: 'message.part.delta',
      properties: { part: { sessionID: 'existing-session' } }
    })
    releaseStatus?.()

    await expect(recovery).resolves.toBe('superseded')
    expect(mocks.sessionAbort).not.toHaveBeenCalled()
    expect(mocks.sessionPromptAsync).not.toHaveBeenCalled()
  })

  it('does not abort when a Task child resumes during the recovery check', async () => {
    mocks.bridgeEvent?.({
      type: 'session.created',
      properties: { info: { id: 'child-session', parentID: 'existing-session' } }
    })
    let releaseStatus: (() => void) | undefined
    mocks.sessionStatus.mockImplementationOnce(() => new Promise((resolve) => {
      releaseStatus = () => resolve({ data: { 'existing-session': { type: 'busy' } } })
    }))

    const recovery = agentController.recoverStalledAgent('agent-1', 'Synthetic recovery prompt', Date.now())
    await vi.waitFor(() => expect(mocks.sessionStatus).toHaveBeenCalledOnce())
    mocks.bridgeEvent?.({
      type: 'message.part.delta',
      properties: { part: { sessionID: 'child-session' } }
    })
    releaseStatus?.()

    await expect(recovery).resolves.toBe('superseded')
    expect(mocks.sessionAbort).not.toHaveBeenCalled()
  })

  it('bounds recovery when the abort request never resolves', async () => {
    vi.useFakeTimers()
    mocks.sessionStatus.mockResolvedValueOnce({ data: {
      'existing-session': { type: 'busy' }
    } })
    let releaseAbort: (() => void) | undefined
    mocks.sessionAbort.mockReturnValueOnce(new Promise<void>((resolve) => {
      releaseAbort = resolve
    }))

    const recovery = agentController.recoverStalledAgent('agent-1', 'Synthetic recovery prompt', Date.now())
    await vi.advanceTimersByTimeAsync(12_001)

    await expect(recovery).resolves.toBe('timeout')
    await expect(agentController.sendMessage('agent-1', 'Real user prompt')).rejects.toThrow(
      'Stall recovery is still stopping the previous request'
    )
    expect(mocks.sessionPromptAsync).not.toHaveBeenCalled()

    releaseAbort?.()
    await vi.advanceTimersByTimeAsync(0)
    await agentController.sendMessage('agent-1', 'Real user prompt')
    expect(mocks.sessionPromptAsync).toHaveBeenCalledOnce()
  })

  it.each([
    ['waiting', 'blocked'],
    ['completed', 'completed']
  ])('does not abort or resume a %s session', async (sessionStatus, expectedResult) => {
    mocks.sessionStatus.mockResolvedValueOnce({ data: {
      'existing-session': { type: sessionStatus }
    } })
    const result = await agentController.recoverStalledAgent(
      'agent-1',
      'Do not send this',
      Date.now() + 60_000
    )

    expect(result).toBe(expectedResult)
    expect(mocks.sessionAbort).not.toHaveBeenCalled()
    expect(mocks.sessionPromptAsync).not.toHaveBeenCalled()
  })
})
