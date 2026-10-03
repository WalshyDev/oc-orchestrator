import { afterEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  start: undefined as (() => Promise<void>) | undefined,
  initialize: vi.fn(),
  createWindow: vi.fn(function () {
    return {
      on: vi.fn(),
      loadFile: vi.fn(),
      loadURL: vi.fn(),
      webContents: {
        setWindowOpenHandler: vi.fn(),
        on: vi.fn(),
        once: vi.fn(),
        isLoading: () => true
      }
    }
  })
}))

vi.mock('../main/logger', () => ({}))
vi.mock('../main/ipc', () => ({ registerIpcHandlers: vi.fn() }))
vi.mock('../main/services/database', () => ({
  database: { init: state.initialize, logEvent: vi.fn(), getPreference: vi.fn() }
}))
vi.mock('../main/services/agent-controller', () => ({
  agentController: { startIdleRuntimeChecks: vi.fn() }
}))
vi.mock('../main/services/runtime-manager', () => ({
  runtimeManager: { startHealthChecks: vi.fn() }
}))
vi.mock('../main/services/update-checker', () => ({ startUpdateChecker: vi.fn() }))
vi.mock('../main/services/external-api', () => ({ startExternalApi: vi.fn().mockResolvedValue(undefined) }))
vi.mock('electron', () => ({
  app: {
    getPath: () => '/isolated/user-data',
    setName: vi.fn(),
    setPath: vi.fn(),
    on: vi.fn(),
    whenReady: () => ({ then: (start: () => Promise<void>) => { state.start = start } })
  },
  BrowserWindow: state.createWindow,
  nativeImage: { createFromPath: vi.fn() },
  Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn() },
  shell: {},
  dialog: {}
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('waits for database initialization before creating a renderer that loads settings', async () => {
  let finishInitialization!: () => void
  state.initialize.mockImplementation(() => new Promise<void>((resolve) => { finishInitialization = resolve }))
  vi.stubGlobal('__dirname', '/isolated/main')
  vi.spyOn(console, 'log').mockImplementation(() => {})
  await import('../main/index')
  const startup = state.start!()
  expect(state.initialize).toHaveBeenCalledOnce()
  expect(state.createWindow).not.toHaveBeenCalled()
  finishInitialization()
  await startup
  expect(state.createWindow).toHaveBeenCalledOnce()
})
