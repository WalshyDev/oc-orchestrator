import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { createOpencodeClient } from '@opencode-ai/sdk/v2/client'
import {
  createCompatTransport,
  hasMessagePersistence,
  installMessagePersistenceCompat,
  readRuntimeHealth
} from '../main/services/opencode-compat'
import { runtimeManager } from '../main/services/runtime-manager'

const children: Array<{
  stdout: PassThrough
  stderr: PassThrough
  kill: ReturnType<typeof vi.fn>
  env: NodeJS.ProcessEnv
}> = []

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('@opencode-ai/sdk/v2/client', () => ({ createOpencodeClient: vi.fn(() => ({})) }))
vi.mock('../main/services/opencode-compat', () => ({
  readRuntimeHealth: vi.fn(),
  hasMessagePersistence: vi.fn(),
  installMessagePersistenceCompat: vi.fn(),
  createCompatTransport: vi.fn(() => ({ fetch: vi.fn(), close: vi.fn() }))
}))
vi.mock('node:child_process', () => ({
  spawn: vi.fn((_command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(),
      env: options.env
    })
    children.push(child)
    queueMicrotask(() => {
      const port = args[2].split('=')[1]
      child.stdout.write(`opencode server listening on http://127.0.0.1:${port}\n`)
    })
    return child
  })
}))

beforeEach(() => {
  vi.clearAllMocks()
  children.length = 0
  vi.mocked(readRuntimeHealth).mockResolvedValue('2.0-test')
  vi.mocked(installMessagePersistenceCompat).mockResolvedValue('/test/opencode.db')
})

afterEach(() => {
  runtimeManager.stopAll()
})

describe('runtime compatibility startup', () => {
  it('reuses a native runtime without installing compatibility', async () => {
    vi.mocked(hasMessagePersistence).mockResolvedValue(true)
    const runtime = await runtimeManager.ensureRuntime('/native-project')
    expect(await runtimeManager.ensureRuntime('/native-project')).toBe(runtime)
    expect(children).toHaveLength(1)
    expect(runtime.messagePersistenceCompat).toBe(false)
    expect(installMessagePersistenceCompat).not.toHaveBeenCalled()
    expect(createCompatTransport).not.toHaveBeenCalled()
    runtimeManager.stopAll()
    expect(children[0].kill).toHaveBeenCalledOnce()
  })

  it.each([true, false])('respawns and verifies persistence (recheck=%s)', async (recheck) => {
    vi.mocked(hasMessagePersistence).mockResolvedValueOnce(false).mockResolvedValueOnce(recheck)
    const startup = runtimeManager.ensureRuntime('/compat-project')
    if (recheck) {
      expect((await startup).messagePersistenceCompat).toBe(true)
    } else {
      await expect(startup).rejects.toThrow('still drops message parts')
      expect(runtimeManager.getAllRuntimes()).toEqual([])
    }
    expect(children).toHaveLength(2)
    expect(children[0].kill).toHaveBeenCalledOnce()
    expect(vi.mocked(installMessagePersistenceCompat).mock.invocationCallOrder[0])
      .toBeLessThan(children[0].kill.mock.invocationCallOrder[0])
    expect(children[1].env).toMatchObject({
      OPENCODE_DB: '/test/opencode.db',
      OPENCODE_EXPERIMENTAL_WORKSPACES: '1'
    })
    const transport = vi.mocked(createCompatTransport).mock.results[0].value
    expect(createOpencodeClient).toHaveBeenLastCalledWith(expect.objectContaining({ fetch: transport.fetch }))
    runtimeManager.stopAll()
    expect(children[1].kill).toHaveBeenCalledOnce()
    expect(transport.close).toHaveBeenCalledOnce()
  })

  it('closes the first server when compatibility installation fails and permits retry', async () => {
    vi.mocked(hasMessagePersistence).mockResolvedValue(false)
    vi.mocked(installMessagePersistenceCompat).mockRejectedValueOnce(new Error('Unsupported schema'))
    await expect(runtimeManager.ensureRuntime('/failed-project')).rejects.toThrow('Unsupported schema')
    expect(children).toHaveLength(1)
    expect(children[0].kill).toHaveBeenCalledOnce()
    expect(runtimeManager.getAllRuntimes()).toEqual([])
    vi.mocked(hasMessagePersistence).mockResolvedValue(true)
    await runtimeManager.ensureRuntime('/failed-project')
    expect(children).toHaveLength(2)
  })
})
