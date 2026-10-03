import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request as httpRequest } from 'node:http'

const mocks = vi.hoisted(() => ({
  userData: '',
  preferences: new Map<string, string>(),
  broadcast: vi.fn(),
  launch: vi.fn(),
  resume: vi.fn(),
  runtimeAvailable: true,
  agents: [
    { id: 'parent-agent', sessionId: 'ses_parent', directory: '/repo/parent', title: 'Parent' },
    { id: 'child-agent', sessionId: 'ses_child', directory: '/repo/child', title: 'Child' }
  ]
}))

vi.mock('electron', () => ({
  app: { getPath: () => mocks.userData },
  BrowserWindow: { getAllWindows: () => [{ webContents: { send: mocks.broadcast } }] }
}))
vi.mock('../main/services/database', () => ({ database: {
  getPreference: (key: string) => mocks.preferences.get(key),
  setPreference: (key: string, value: string) => mocks.preferences.set(key, value),
  ensureProject: vi.fn()
} }))
vi.mock('../main/services/agent-controller', () => ({
  agentController: {
    getAllAgents: () => mocks.agents,
    launchAgent: mocks.launch,
    resumeAgent: mocks.resume
  },
  parseModelString: vi.fn()
}))
vi.mock('../main/services/runtime-manager', () => ({ runtimeManager: {
  getRuntime: () => mocks.runtimeAvailable ? { serverUrl: 'http://127.0.0.1:1234' } : undefined
} }))
vi.mock('../main/services/workspace-manager', () => ({ workspaceManager: {
  isGitRepo: () => true,
  getRepoRoot: (dir: string) => dir
} }))
vi.mock('../main/services/lease-registry', () => ({ leaseRegistry: {
  acquire: () => ({ id: 'lease', expiresAt: 123 })
} }))
vi.mock('../main/services/notification-service', () => ({ notificationService: {
  notifyExternalAttached: vi.fn()
} }))
vi.mock('../main/version', () => ({ getAppVersion: () => 'test' }))

import { startExternalApi, stopExternalApi } from '../main/services/external-api'
import { folderManager } from '../main/services/folder-manager'

let baseUrl: string
let token: string

async function request(path: string, method = 'GET', body?: unknown, authorized = true) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: authorized ? { Authorization: `Bearer ${token}` } : {},
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  return { status: response.status, body: await response.json() }
}

beforeAll(async () => {
  mocks.userData = mkdtempSync(join(tmpdir(), 'oco-folders-test-'))
  await startExternalApi()
  const discovery = JSON.parse(readFileSync(join(mocks.userData, 'api.json'), 'utf8'))
  baseUrl = `http://127.0.0.1:${discovery.port}`
  token = discovery.token
})

afterAll(() => {
  stopExternalApi()
  rmSync(mocks.userData, { recursive: true, force: true })
})

beforeEach(() => {
  mocks.agents = [
    { id: 'parent-agent', sessionId: 'ses_parent', directory: '/repo/parent', title: 'Parent' },
    { id: 'child-agent', sessionId: 'ses_child', directory: '/repo/child', title: 'Child' }
  ]
  mocks.preferences.clear()
  mocks.runtimeAvailable = true
  mocks.broadcast.mockClear()
  mocks.launch.mockReset()
  mocks.launch.mockResolvedValue({ ...mocks.agents[1], runtimeId: 'runtime', projectName: 'repo' })
  mocks.resume.mockReset()
  mocks.resume.mockImplementation(async (options) => {
    mocks.runtimeAvailable = true
    return mocks.agents.find((agent) => agent.sessionId === options.sessionId && agent.directory === options.directory)
      ?? { id: 'resumed-agent', sessionId: options.sessionId, directory: options.directory, runtimeId: 'runtime', projectName: 'repo' }
  })
})

describe('external folder API', () => {
  it('keeps a handoff child in its parent folder and removes membership without deleting sessions', async () => {
    const created = await request('/folders', 'POST', { name: ' AI config ' })
    expect(created.status).toBe(201)
    const folderId = created.body.id
    expect(created.body.name).toBe('AI config')
    expect((await request('/folders')).body.folders).toEqual([created.body])
    await request('/sessions/ses_parent/folder', 'PUT', { folderId })
    const parent = await request('/sessions/ses_parent/folder')
    expect(parent.body).toMatchObject({ directory: '/repo/parent', folderId })
    const child = await request('/sessions', 'POST', { dir: '/repo/child', prompt: 'Continue', folderId: parent.body.folderId })
    expect(child.status).toBe(200)
    expect(child.body.folderId).toBe(folderId)
    expect((await request('/sessions/ses_child/folder')).body.folderId).toBe(folderId)
    expect((await request('/sessions')).body.sessions).toMatchObject([
      { agentId: 'parent-agent', sessionId: 'ses_parent', directory: '/repo/parent', title: 'Parent', folderId },
      { agentId: 'child-agent', sessionId: 'ses_child', directory: '/repo/child', title: 'Child', folderId }
    ])
    await request(`/folders/${folderId}`, 'PATCH', { name: 'Handoffs' })
    expect((await request('/sessions/ses_parent/folder')).body.folder.name).toBe('Handoffs')
    await request('/sessions/ses_child/folder', 'DELETE')
    expect((await request('/sessions/ses_child/folder')).body.folderId).toBeNull()
    expect((await request('/sessions/ses_parent/folder')).body.folderId).toBe(folderId)
    await request(`/folders/${folderId}`, 'DELETE')
    expect((await request('/sessions/ses_parent/folder')).body.folder).toBeNull()
    expect(mocks.agents).toHaveLength(2)
    expect(mocks.broadcast).toHaveBeenLastCalledWith('folders:changed', { folders: [], membership: {} })
  })

  it('rejects unauthorized requests, invalid input, and unknown identities before launching', async () => {
    expect((await request('/folders', 'POST', { name: 'Secret' }, false)).status).toBe(401)
    for (const name of ['', ' ', 12, null]) {
      expect((await request('/folders', 'POST', { name })).status).toBe(400)
    }
    expect((await request('/folders', 'POST', null)).status).toBe(400)
    expect((await request('/sessions/ses_missing/folder', 'PUT', { folderId: null })).status).toBe(404)
    expect((await request('/sessions/ses_parent/folder', 'PUT', {})).status).toBe(400)
    expect((await request('/sessions/ses_parent/folder', 'PUT', { folderId: 'missing' })).status).toBe(404)
    expect((await request('/sessions', 'POST', { dir: '/repo', folderId: 'missing' })).status).toBe(404)
    expect(mocks.launch).not.toHaveBeenCalled()
    expect(mocks.resume).not.toHaveBeenCalled()
    expect(folderManager.getSnapshot()).toEqual({ folders: [], membership: {} })
  })

  it('migrates existing UI folders once and preserves newer API assignments', async () => {
    const legacy = {
      folders: [{ id: 'legacy', name: 'Existing', sortOrder: 0 }],
      membership: { 'parent-agent': 'legacy', 'child-agent': 'legacy', stale: 'missing' }
    }
    const folder = folderManager.create('API folder')
    folderManager.setAgentFolder('child-agent', folder.id)
    folderManager.migrateLegacy(legacy)
    expect(folderManager.getAgentFolder('parent-agent')?.id).toBe('legacy')
    expect(folderManager.getAgentFolder('child-agent')?.id).toBe(folder.id)
    expect(folderManager.getSnapshot().membership.stale).toBeUndefined()
    await request('/sessions/ses_parent/folder', 'PUT', { folderId: null })
    folderManager.delete('legacy')
    folderManager.migrateLegacy(legacy)
    expect(folderManager.getAgentFolder('parent-agent')).toBeNull()
    expect(folderManager.getSnapshot().folders).toEqual([folder])
  })

  it('preserves explicit removals made before the legacy migration', async () => {
    await request('/sessions/ses_parent/folder', 'DELETE')
    folderManager.migrateLegacy({
      folders: [{ id: 'legacy', name: 'Existing', sortOrder: 0 }],
      membership: { 'parent-agent': 'legacy', 'child-agent': 'legacy' }
    })
    expect(folderManager.getAgentFolder('parent-agent')).toBeNull()
    expect(folderManager.getAgentFolder('child-agent')?.id).toBe('legacy')
  })

  it('reuses the tracked row when resuming a session and preserves or changes its folder', async () => {
    const first = folderManager.create('First')
    const second = folderManager.create('Second')
    folderManager.setAgentFolder('parent-agent', first.id)
    const resumed = await request('/sessions', 'POST', { dir: '/repo/parent', resume: 'ses_parent' })
    expect(resumed.body).toMatchObject({ agentId: 'parent-agent', sessionId: 'ses_parent', folderId: first.id })
    const moved = await request('/sessions', 'POST', { dir: '/repo/parent', resume: 'ses_parent', folderId: second.id })
    expect(moved.body).toMatchObject({ agentId: 'parent-agent', folderId: second.id })
    expect((await request('/sessions/ses_parent/folder')).body.folderId).toBe(second.id)
    expect(mocks.launch).not.toHaveBeenCalled()
    mocks.runtimeAvailable = false
    const reconnected = await request('/sessions', 'POST', { dir: '/repo/parent', resume: 'ses_parent' })
    expect(reconnected.status).toBe(200)
    expect(reconnected.body).toMatchObject({ agentId: 'parent-agent', folderId: second.id })
    expect(mocks.resume).toHaveBeenCalled()
    expect((await request('/sessions', 'POST', { dir: '/wrong', resume: 'ses_parent' })).status).toBe(400)
    mocks.agents.push({ ...mocks.agents[0], id: 'duplicate' })
    expect((await request('/sessions', 'POST', { dir: '/repo/parent', resume: 'ses_parent' })).status).toBe(409)
    expect((await request('/sessions/ses_parent/folder', 'PUT', { folderId: null })).status).toBe(409)
    expect(folderManager.getAgentFolder('parent-agent')?.id).toBe(second.id)
  })

  it.each(['reset', 'remove'])('rejects a delayed assignment after a session %s', async (action) => {
    const folder = folderManager.create('Folder')
    let finishRequest: () => void = () => {}
    const responsePromise = new Promise<number>((resolve, reject) => {
      const req = httpRequest(`${baseUrl}/sessions/ses_parent/folder`, {
        method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Transfer-Encoding': 'chunked' }
      }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode!)) })
      req.on('error', reject)
      req.write('{"folderId":')
      finishRequest = () => req.end(`${JSON.stringify(folder.id)}}`)
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    if (action === 'reset') mocks.agents[0].sessionId = 'ses_replacement'
    else mocks.agents.shift()
    finishRequest()
    expect(await responsePromise).toBe(404)
    expect(folderManager.getSnapshot().membership).toEqual({})
  })
})
