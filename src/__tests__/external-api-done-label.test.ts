import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  userData: '',
  setPreference: vi.fn(),
  sendToRenderer: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: () => mocks.userData },
  BrowserWindow: {
    getAllWindows: () => [{
      isDestroyed: () => false,
      webContents: { isDestroyed: () => false, send: mocks.sendToRenderer }
    }]
  }
}))
vi.mock('../main/services/runtime-manager', () => ({
  runtimeManager: { ensureRuntime: async () => ({ id: 'runtime-test', client: {} }) }
}))
vi.mock('../main/services/event-bridge', () => ({
  EventBridge: class { async start(): Promise<void> {} }
}))
vi.mock('../main/services/workspace-manager', () => ({
  workspaceManager: {
    getDirectoryContext: () => ({ repoName: 'test', branchName: 'main', isWorktree: false, workspaceName: 'test' })
  }
}))
vi.mock('../main/services/database', () => ({
  database: {
    getPreference: () => JSON.stringify([
      { id: 'agent-test', sessionId: 'session-test', directory: '/synthetic', prompt: '', title: 'Test' },
      { id: 'other-agent', sessionId: 'other-session', directory: '/synthetic', prompt: '', title: 'Other' }
    ]),
    setPreference: mocks.setPreference
  }
}))
vi.mock('../main/services/lease-registry', () => ({ leaseRegistry: {} }))
vi.mock('../main/services/notification-service', () => ({ notificationService: {} }))

const { agentController } = await import('../main/services/agent-controller')
const { startExternalApi, stopExternalApi } = await import('../main/services/external-api')

describe('External API Done labels', () => {
  let api: { port: number; token: string }
  const existingPrUrl = 'https://github.com/example/repo/pull/1'

  async function patch(body: string, sessionId = 'session-test', token: string | null = api.token) {
    const response = await fetch(`http://127.0.0.1:${api.port}/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(token === null ? {} : { Authorization: `Bearer ${token}` })
      },
      body
    })
    return { status: response.status, body: await response.json() }
  }

  function persistedAgents() {
    expect(mocks.setPreference).toHaveBeenLastCalledWith('active_agents', expect.any(String))
    return JSON.parse(mocks.setPreference.mock.calls.at(-1)![1]) as Array<{
      id: string; labelIds: string[]; prUrl?: string
    }>
  }

  beforeAll(async () => {
    mocks.userData = mkdtempSync(join(tmpdir(), 'oco-done-label-'))
    await agentController.restorePersistedAgents()
    await startExternalApi()
    api = JSON.parse(readFileSync(join(mocks.userData, 'api.json'), 'utf-8')) as typeof api
  })

  beforeEach(() => {
    agentController.updateAgentMeta('agent-test', { labelIds: ['in_review', 'custom-label'], prUrl: existingPrUrl })
    agentController.updateAgentMeta('other-agent', { labelIds: ['blocked'] })
    mocks.setPreference.mockClear()
    mocks.sendToRenderer.mockClear()
  })

  afterAll(() => {
    stopExternalApi()
    rmSync(mocks.userData, { recursive: true, force: true })
  })

  it('persists Done once, preserves other metadata, and broadcasts the resulting labels', async () => {
    const expected = { status: 200, body: { ok: true, labelIds: ['in_review', 'custom-label', 'done'] } }
    expect(await patch('{"addLabelId":"done"}')).toEqual(expected)
    expect(await patch('{"addLabelId":"done"}')).toEqual(expected)
    expect(mocks.setPreference).toHaveBeenCalledTimes(1)
    expect(persistedAgents()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'agent-test', labelIds: expected.body.labelIds, prUrl: existingPrUrl }),
      expect.objectContaining({ id: 'other-agent', labelIds: ['blocked'] })
    ]))
    expect(mocks.sendToRenderer).toHaveBeenCalledExactlyOnceWith('agent:labels-updated', {
      id: 'agent-test', sessionId: 'session-test', labelIds: expected.body.labelIds
    })
  })

  it.each([
    [undefined, ['done']],
    [[], ['done']],
    [['done', 'custom-label'], ['done', 'custom-label']]
  ])('handles initial labels %j', async (labelIds, expected) => {
    const agent = agentController.getAllAgents().find((agent) => agent.id === 'agent-test')!
    agent.labelIds = labelIds
    expect(await patch('{"addLabelId":"done"}')).toEqual({ status: 200, body: { ok: true, labelIds: expected } })
    expect(agent.labelIds).toEqual(expected)
  })

  it('keeps legacy labels when adding Done', async () => {
    const agent = agentController.getAllAgents().find((agent) => agent.id === 'agent-test')!
    agent.labelIds = undefined
    agent.labelId = 'draft'
    try {
      expect(await patch('{"addLabelId":"done"}')).toEqual({ status: 200, body: { ok: true, labelIds: ['draft', 'done'] } })
    } finally {
      delete agent.labelId
    }
  })

  it.each([
    [{ clearLabels: true }, []],
    [{ clearLabels: true, addLabelId: 'done' }, ['done']]
  ])('clears existing labels with %j and persists the result once', async (body, expected) => {
    const agent = agentController.getAllAgents().find((agent) => agent.id === 'agent-test')!
    agent.labelIds = ['in_review', 'custom-label', 'done']
    const response = { status: 200, body: { ok: true, labelIds: expected } }
    expect(await patch(JSON.stringify(body))).toEqual(response)
    expect(await patch(JSON.stringify(body))).toEqual(response)
    expect(mocks.setPreference).toHaveBeenCalledTimes(1)
    expect(persistedAgents()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'agent-test', labelIds: expected, prUrl: existingPrUrl }),
      expect.objectContaining({ id: 'other-agent', labelIds: ['blocked'] })
    ]))
    expect(mocks.sendToRenderer).toHaveBeenCalledExactlyOnceWith('agent:labels-updated', {
      id: 'agent-test', sessionId: 'session-test', labelIds: expected
    })
  })

  it('clears a legacy label and updates the PR link in the same request', async () => {
    const agent = agentController.getAllAgents().find((agent) => agent.id === 'agent-test')!
    agent.labelIds = undefined
    agent.labelId = 'draft'
    const prUrl = 'https://example.com/pr/3'
    try {
      expect(await patch(JSON.stringify({ clearLabels: true, prUrl }))).toEqual({
        status: 200, body: { ok: true, labelIds: [] }
      })
      expect(persistedAgents().find((agent) => agent.id === 'agent-test')).toMatchObject({ labelIds: [], prUrl })
    } finally {
      delete agent.labelId
    }
  })

  it.each([null, 'wrong-token', '0'.repeat(64)])('requires valid authentication (%j)', async (token) => {
    expect(await patch('{"addLabelId":"done"}', 'session-test', token)).toEqual({ status: 401, body: { error: 'unauthorized' } })
    expect(mocks.setPreference).not.toHaveBeenCalled()
  })

  it.each(['missing', 'agent-test', 'session-tes', 'SESSION-TEST'])('requires the exact tracked session ID (%s)', async (id) => {
    expect(await patch('{"addLabelId":"done"}', id)).toEqual({ status: 404, body: { error: 'session_not_found' } })
    expect(mocks.setPreference).not.toHaveBeenCalled()
  })

  it.each([
    '{', 'null', '[]', 'true', '{}',
    '{"clearLabels":null}', '{"clearLabels":false}', '{"clearLabels":"true"}',
    '{"clearLabels":true,"addLabelId":"close"}',
    '{"clearLabels":true,"prUrl":"file:///tmp/pr"}',
    '{"clearLabels":"true","prUrl":"https://example.com/pr"}',
    '{"addLabelId":null}', '{"addLabelId":"Done"}', '{"addLabelId":false}',
    '{"addLabelId":"blocked","prUrl":"https://example.com/pr"}',
    '{"addLabelId":"done","prUrl":"file:///tmp/pr"}',
    '{"addLabelId":"done","prUrl":""}', '{"addLabelId":"done","prUrl":null}',
    '{"labelIds":[]}'
  ])('rejects invalid updates without writes (%s)', async (body) => {
    expect(await patch(body)).toEqual({ status: 400, body: { error: 'bad_request', message: expect.any(String) } })
    expect(mocks.setPreference).not.toHaveBeenCalled()
    expect(mocks.sendToRenderer).not.toHaveBeenCalled()
  })

  it('ignores a replacement label list while adding Done', async () => {
    expect(await patch('{"addLabelId":"done","labelIds":[]}')).toEqual({
      status: 200, body: { ok: true, labelIds: ['in_review', 'custom-label', 'done'] }
    })
  })

  it('preserves PR URL validation and response for PR only and combined updates', async () => {
    const prUrl = 'http://example.com/pr/2'
    expect(await patch(JSON.stringify({ prUrl: ` ${prUrl} ` }))).toEqual({ status: 200, body: { ok: true, prUrl } })
    expect(persistedAgents().find((agent) => agent.id === 'agent-test')).toMatchObject({ labelIds: ['in_review', 'custom-label'], prUrl })
    expect(await patch(JSON.stringify({ prUrl, addLabelId: 'done' }))).toEqual({
      status: 200, body: { ok: true, labelIds: ['in_review', 'custom-label', 'done'] }
    })
    expect(persistedAgents().find((agent) => agent.id === 'agent-test')).toMatchObject({ labelIds: ['in_review', 'custom-label', 'done'], prUrl })
  })

  it('fails closed for duplicate tracked sessions while retaining PR only behavior', async () => {
    const other = agentController.getAllAgents().find((agent) => agent.id === 'other-agent')!
    other.sessionId = 'session-test'
    try {
      expect(await patch(JSON.stringify({ addLabelId: 'done', prUrl: existingPrUrl }))).toEqual({ status: 409, body: { error: 'session_ambiguous' } })
      expect(await patch(JSON.stringify({ clearLabels: true, prUrl: existingPrUrl }))).toEqual({ status: 409, body: { error: 'session_ambiguous' } })
      expect(mocks.setPreference).not.toHaveBeenCalled()
      expect(await patch(JSON.stringify({ prUrl: existingPrUrl }))).toEqual({ status: 200, body: { ok: true, prUrl: existingPrUrl } })
      expect(persistedAgents().every((agent) => agent.prUrl === existingPrUrl)).toBe(true)
    } finally {
      other.sessionId = 'other-session'
    }
  })
})
