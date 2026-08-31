import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sessionCommand: vi.fn(),
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
]

const runtime = {
  id: 'runtime-1',
  directory: '/tmp/project',
  client: {
    session: {
      command: mocks.sessionCommand,
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
})
