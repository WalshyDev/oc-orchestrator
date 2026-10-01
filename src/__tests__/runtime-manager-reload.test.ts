import type { OpencodeClient } from '@opencode-ai/sdk/v2/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeInfo } from '../main/services/runtime-manager'

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => []
  }
}))

const { runtimeManager } = await import('../main/services/runtime-manager')

function runtime(directory: string, statuses: Record<string, { type: string }>): {
  info: RuntimeInfo
  dispose: ReturnType<typeof vi.fn>
} {
  const status = vi.fn().mockResolvedValue({ data: statuses })
  const dispose = vi.fn().mockResolvedValue({ data: true })
  const client = {
    session: { status },
    instance: { dispose }
  } as unknown as OpencodeClient

  return {
    info: {
      id: `runtime-${directory}`,
      directory,
      serverUrl: 'http://127.0.0.1:1234',
      port: 1234,
      client,
      close: vi.fn(),
      startedAt: 0,
      lastActivityAt: 0,
      activeSessions: 0,
      healthy: true
    },
    dispose
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('RuntimeManager.reloadAiConfig', () => {
  it('disposes idle runtimes', async () => {
    const idle = runtime('/idle', { session: { type: 'idle' } })
    vi.spyOn(runtimeManager, 'getAllRuntimes').mockReturnValue([idle.info])

    await expect(runtimeManager.reloadAiConfig()).resolves.toEqual({
      skippedBusy: [],
      failed: []
    })
    expect(idle.dispose).toHaveBeenCalledOnce()
  })

  it('skips runtimes with active sessions', async () => {
    const busy = runtime('/busy', { session: { type: 'busy' } })
    vi.spyOn(runtimeManager, 'getAllRuntimes').mockReturnValue([busy.info])

    await expect(runtimeManager.reloadAiConfig()).resolves.toEqual({
      skippedBusy: ['/busy'],
      failed: []
    })
    expect(busy.dispose).not.toHaveBeenCalled()
  })

  it('continues when one runtime fails', async () => {
    const failed = runtime('/failed', {})
    const idle = runtime('/idle', {})
    failed.dispose.mockRejectedValue(new Error('dispose failed'))
    vi.spyOn(runtimeManager, 'getAllRuntimes').mockReturnValue([failed.info, idle.info])

    await expect(runtimeManager.reloadAiConfig()).resolves.toEqual({
      skippedBusy: [],
      failed: ['/failed']
    })
    expect(idle.dispose).toHaveBeenCalledOnce()
  })
})
