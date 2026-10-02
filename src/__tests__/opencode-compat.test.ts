import { afterEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createOpencodeClient } from '@opencode-ai/sdk/v2/client'
import {
  createCompatTransport,
  hasMessagePersistence,
  installPartCompatTrigger,
  PART_COMPAT_TRIGGER,
  readRuntimeHealth
} from '../main/services/opencode-compat'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('OpenCode compatibility', () => {
  it.each([
    { healthy: true, version: '1.18.34' },
    { healthy: true, version: '0.0.0-compat-2.0' }
  ])('reads the JSON health endpoint for $version', async (health) => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(health))
    vi.stubGlobal('fetch', fetchMock)
    expect(await readRuntimeHealth('http://localhost:4096')).toBe(health.version)
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:4096/global/health')
  })

  it.each([
    new Response('<html>app shell</html>', { status: 200 }),
    Response.json({ healthy: false, version: '1.18.34' }),
    Response.json({ healthy: true }),
    Response.json({ healthy: true, version: '' }),
    new Response('', { status: 503 })
  ])('rejects an unhealthy or invalid response', async (response) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    await expect(readRuntimeHealth('http://localhost:4096')).rejects.toThrow()
  })

  it('accepts prompts while a reply is pending, reports failures, and cancels streams on close', async () => {
    const requests: Request[] = []
    const complete: Array<(response: Response) => void> = []
    const onError = vi.fn()
    const fetchMock = vi.fn().mockImplementation((request: Request, init?: RequestInit) => {
      requests.push(request)
      if (request.method === 'GET') {
        return Promise.resolve(Response.json({ healthy: true }))
      }
      return new Promise<Response>((resolve, reject) => {
        complete.push(resolve)
        init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')))
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const transport = createCompatTransport(onError)
    const url = 'http://localhost:4096/session/ses_test/prompt_async?directory=%2Fproject'
    const init = {
      method: 'POST',
      headers: { Authorization: 'Basic test', 'Content-Type': 'application/json' },
      body: '{"parts":[{"type":"text","text":"hello"}]}'
    }
    expect((await transport.fetch(url, init)).status).toBe(204)
    expect(requests[0].url).toBe('http://localhost:4096/session/ses_test/message?directory=%2Fproject')
    expect(requests[0].headers.get('Authorization')).toBe('Basic test')
    expect(await requests[0].text()).toBe(init.body)
    expect(onError).not.toHaveBeenCalled()
    complete[0](new Response('Unknown session', { status: 404 }))
    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        'ses_test',
        expect.objectContaining({ message: expect.stringContaining('404') })
      )
    })
    expect((await transport.fetch(url, init)).status).toBe(204)
    transport.close()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(onError).toHaveBeenCalledTimes(1)
    expect((await transport.fetch('http://localhost:4096/global/health')).status).toBe(200)
    expect(requests[2].url).toBe('http://localhost:4096/global/health')
  })

  it('preserves probe and cleanup failures and rejects cleanup failures after a successful probe', async () => {
    const probeError = new Error('Prompt failed')
    const cleanupError = new Error('Delete failed')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ id: 'ses_probe' }))
      .mockRejectedValueOnce(probeError)
      .mockRejectedValueOnce(cleanupError)
    const client = createOpencodeClient({ baseUrl: 'http://localhost:4096', fetch: fetchMock })
    await expect(hasMessagePersistence(client)).rejects.toMatchObject({
      errors: [probeError, cleanupError],
      cause: probeError
    })
    fetchMock
      .mockResolvedValueOnce(Response.json({ id: 'ses_probe' }))
      .mockResolvedValueOnce(Response.json({ parts: [{ id: 'prt_probe', type: 'text', text: 'probe' }] }))
      .mockResolvedValueOnce(Response.json([{ parts: [{ id: 'prt_probe', type: 'text', text: 'probe' }] }]))
      .mockRejectedValueOnce(cleanupError)
    await expect(hasMessagePersistence(client)).rejects.toBe(cleanupError)
  })

  it('projects all part types atomically and ignores updates for removed messages', () => {
    const db = new DatabaseSync(':memory:')
    try {
      db.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL);
        CREATE TABLE part (
          id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES message(id) ON DELETE CASCADE,
          session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
        );
        CREATE TABLE event (id TEXT PRIMARY KEY, aggregate_id TEXT, seq INTEGER, type TEXT, data TEXT);
        INSERT INTO message VALUES ('msg_1', 'ses_1');
      `)
      db.exec(PART_COMPAT_TRIGGER)
      db.exec(PART_COMPAT_TRIGGER)
      const append = db.prepare('INSERT INTO event VALUES (?, ?, ?, ?, ?)')
      const parts = [
        { id: 'prt_text', type: 'text', text: 'hello' },
        { id: 'prt_reasoning', type: 'reasoning', text: 'thinking' },
        { id: 'prt_file', type: 'file', mime: 'text/plain', url: 'file:///example.txt' },
        { id: 'prt_tool', type: 'tool', tool: 'write', callID: 'call_1', state: { status: 'pending' } }
      ]
      for (const [i, part] of parts.entries()) {
        append.run(
          `evt_${i}`, 'ses_1', i, 'message.part.updated.1',
          JSON.stringify({
            time: 100 + i,
            part: { ...part, messageID: 'msg_1', sessionID: 'ses_1' }
          })
        )
        const row = db.prepare('SELECT data, time_created FROM part WHERE id = ?').get(part.id)!
        const { id: _id, ...data } = part
        expect(JSON.parse(row.data as string)).toEqual(data)
        expect(row.time_created).toBe(100 + i)
      }
      append.run(
        'evt_update', 'ses_1', 4, 'message.part.updated.1',
        JSON.stringify({
          time: 200,
          part: {
            ...parts[3],
            messageID: 'msg_1',
            sessionID: 'ses_1',
            state: { status: 'completed', output: 'done' }
          }
        })
      )
      const tool = db.prepare('SELECT * FROM part WHERE id = ?').get('prt_tool')!
      expect(JSON.parse(tool.data as string).state).toEqual({ status: 'completed', output: 'done' })
      expect(tool.time_created).toBe(103)
      expect(tool.time_updated).toBe(200)
      db.exec('BEGIN')
      append.run(
        'evt_rollback', 'ses_1', 5, 'message.part.updated.1',
        JSON.stringify({
          time: 200,
          part: {
            id: 'prt_rollback',
            messageID: 'msg_1',
            sessionID: 'ses_1',
            type: 'text',
            text: 'rollback'
          }
        })
      )
      expect(db.prepare('SELECT id FROM part WHERE id = ?').get('prt_rollback')).toBeDefined()
      db.exec('ROLLBACK')
      expect(db.prepare('SELECT id FROM part WHERE id = ?').get('prt_rollback')).toBeUndefined()
      db.exec("DELETE FROM message WHERE id = 'msg_1'")
      append.run(
        'evt_late', 'ses_1', 6, 'message.part.updated.1',
        JSON.stringify({
          time: 300,
          part: { ...parts[0], messageID: 'msg_1', sessionID: 'ses_1' }
        })
      )
      expect(db.prepare('SELECT * FROM part').all()).toEqual([])
    } finally {
      db.close()
    }
  })

  it('refuses an unsupported database schema without installing a trigger', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oco-schema-'))
    const path = join(dir, 'db.sqlite')
    const db = new DatabaseSync(path)
    db.exec('CREATE TABLE event (id TEXT PRIMARY KEY)')
    try {
      await expect(installPartCompatTrigger(path)).rejects.toThrow('event schema')
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all()).toEqual([])
    } finally {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
