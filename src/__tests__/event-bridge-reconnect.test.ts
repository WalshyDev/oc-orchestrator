import type { OpencodeClient } from '@opencode-ai/sdk/v2/client'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  subscribe: vi.fn(),
  touchRuntimeActivity: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [{
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: mocks.send
      }
    }]
  }
}))

vi.mock('../main/services/runtime-manager', () => ({
  runtimeManager: { touchRuntimeActivity: mocks.touchRuntimeActivity }
}))

const { EventBridge } = await import('../main/services/event-bridge')

function pendingStream(): AsyncIterable<{ type: string; properties: unknown }> {
  return {
    [Symbol.asyncIterator]() {
      return { next: () => new Promise(() => {}) }
    }
  }
}

describe('EventBridge reconnects', () => {
  it('notifies the renderer after replacing an established event stream', async () => {
    mocks.send.mockReset()
    mocks.subscribe.mockReset()
    mocks.subscribe.mockResolvedValue({ stream: pendingStream() })
    const client = { event: { subscribe: mocks.subscribe } } as unknown as OpencodeClient
    const bridge = new EventBridge('runtime-1', '/tmp/project', client)

    await bridge.start()
    expect(mocks.send).not.toHaveBeenCalledWith('event:reconnected', expect.anything())

    bridge.stop()
    await bridge.start()

    expect(mocks.send).toHaveBeenCalledWith('event:reconnected', { runtimeId: 'runtime-1' })
    bridge.stop()
  })
})
