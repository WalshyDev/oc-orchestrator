import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  userData: '',
  setAgentPrUrl: vi.fn(),
}))

vi.mock('electron', () => ({
  app: { getPath: () => mocks.userData },
}))

vi.mock('../main/services/agent-controller', () => ({
  agentController: {
    getAllAgents: () => [
      { id: 'agent-1', sessionId: 'session-1' },
      { id: 'agent-2', sessionId: 'session-1' },
    ],
    setAgentPrUrl: mocks.setAgentPrUrl,
  },
  parseModelString: vi.fn(),
}))

vi.mock('../main/services/runtime-manager', () => ({ runtimeManager: {} }))
vi.mock('../main/services/workspace-manager', () => ({ workspaceManager: {} }))
vi.mock('../main/services/database', () => ({ database: {} }))
vi.mock('../main/services/lease-registry', () => ({ leaseRegistry: {} }))
vi.mock('../main/services/notification-service', () => ({ notificationService: {} }))

const { startExternalApi, stopExternalApi } = await import('../main/services/external-api')

describe('External API PR links', () => {
  let api: { port: number; token: string }

  beforeAll(async () => {
    mocks.userData = mkdtempSync(join(tmpdir(), 'oco-external-api-'))
    await startExternalApi()
    api = JSON.parse(readFileSync(join(mocks.userData, 'api.json'), 'utf-8')) as typeof api
  })

  beforeEach(() => mocks.setAgentPrUrl.mockReset())

  afterAll(() => {
    stopExternalApi()
    rmSync(mocks.userData, { recursive: true, force: true })
  })

  it('sets a PR link for an existing session', async () => {
    const prUrl = 'https://github.com/example/repo/pull/1'
    const response = await fetch(`http://127.0.0.1:${api.port}/sessions/session-1`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${api.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prUrl }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, prUrl })
    expect(mocks.setAgentPrUrl.mock.calls).toEqual([
      ['agent-1', prUrl],
      ['agent-2', prUrl],
    ])
  })

  it('rejects invalid links and unknown sessions', async () => {
    const headers = {
      Authorization: `Bearer ${api.token}`,
      'Content-Type': 'application/json',
    }
    const invalidResponse = await fetch(`http://127.0.0.1:${api.port}/sessions/session-1`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ prUrl: 'file:///tmp/report' }),
    })
    const missingResponse = await fetch(`http://127.0.0.1:${api.port}/sessions/missing`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ prUrl: 'https://github.com/example/repo/pull/1' }),
    })

    expect(invalidResponse.status).toBe(400)
    expect(missingResponse.status).toBe(404)
    expect(mocks.setAgentPrUrl).not.toHaveBeenCalled()
  })
})
