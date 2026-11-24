import type { OpencodeClient } from '@opencode-ai/sdk/v2/client'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'

const runFile = promisify(execFile)
const PROBE_TEXT = 'OCO message persistence check'
const WORKSPACE_BOOTSTRAP_TIMEOUT_MS = 120_000
const SQLITE_BUSY = 5

export async function runOpenCodeStep<T>(
  step: string,
  timeout: number,
  run: (options: { signal: AbortSignal; throwOnError: true }) => Promise<T>
): Promise<T> {
  const controller = new AbortController()
  const { signal } = controller
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    return await run({ signal, throwOnError: true })
  } catch (error) {
    if (signal.aborted) throw Object.assign(new Error(`${step} timed out after ${timeout / 1000}s`), { cause: error })
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export function createCompatTransport(onError: (sessionID: string, error: unknown) => void): {
  fetch: typeof fetch
  close: () => void
} {
  const abort = new AbortController()
  return {
    close: () => abort.abort(),
    fetch: async (input, init) => {
      const request = new Request(input, init)
      const url = new URL(request.url)
      const match = request.method === 'POST' && url.pathname.match(/^\/session\/([^/]+)\/prompt_async$/)
      if (!match) {
        return fetch(request)
      }
      url.pathname = url.pathname.replace(/\/prompt_async$/, '/message')
      const signal = AbortSignal.any([request.signal, abort.signal])
      // Keep the synchronous prompt request alive while returning async acceptance to the SDK
      void fetch(new Request(url, request), { signal })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`OpenCode prompt returned status ${response.status}: ${await response.text()}`)
          }
          await response.body?.pipeTo(new WritableStream({ write() {} }))
        })
        .catch((error) => {
          if (!abort.signal.aborted) {
            onError(decodeURIComponent(match[1]), error)
          }
        })
      return new Response(null, { status: 204 })
    }
  }
}

export async function readRuntimeHealth(serverUrl: string): Promise<string> {
  const health: unknown = await runOpenCodeStep('OpenCode runtime health check', 5_000, async ({ signal }) => {
    const response = await fetch(`${serverUrl}/global/health`, { signal })
    if (!response.ok) throw new Error(`OpenCode health check returned status ${response.status}`)
    return response.json()
  })
  if (
    !health ||
    typeof health !== 'object' ||
    !('healthy' in health) ||
    health.healthy !== true ||
    !('version' in health) ||
    typeof health.version !== 'string' ||
    !health.version.trim()
  ) {
    throw new Error('OpenCode returned an invalid /global/health response')
  }
  return health.version
}

export async function hasMessagePersistence(client: OpencodeClient): Promise<boolean> {
  const session = await runOpenCodeStep('OpenCode workspace initialization (compatibility session creation)', WORKSPACE_BOOTSTRAP_TIMEOUT_MS,
    (options) => client.session.create({ title: 'OCO compatibility check' }, options))
  if (!session.data) {
    throw new Error('OpenCode did not create the compatibility check session')
  }
  const sessionID = session.data.id
  let persisted = false
  let probeFailure: { error: unknown } | undefined
  try {
    // noReply stores a user message without contacting a model
    const prompt = await runOpenCodeStep('OpenCode compatibility prompt', 15_000, (options) => client.session.prompt(
      {
        sessionID,
        noReply: true,
        parts: [{ type: 'text', text: PROBE_TEXT }]
      },
      options
    ))
    const sent = prompt.data?.parts.find((part) => part.type === 'text')
    if (!sent || sent.type !== 'text') {
      throw new Error('OpenCode did not return the compatibility check message part')
    }
    const messages = await runOpenCodeStep('OpenCode compatibility history read', 15_000,
      (options) => client.session.messages({ sessionID }, options))
    persisted = !!messages.data?.some((message) =>
      message.parts.some((part) => part.id === sent.id && part.type === 'text' && part.text === sent.text)
    )
  } catch (error) {
    probeFailure = { error }
  }
  try {
    await runOpenCodeStep('OpenCode compatibility cleanup', 15_000,
      (options) => client.session.delete({ sessionID }, options))
  } catch (error) {
    if (probeFailure) {
      throw Object.assign(new Error(`OpenCode compatibility check and cleanup failed: ${String(probeFailure.error)}; ${String(error)}`), {
        errors: [probeFailure.error, error],
        cause: probeFailure.error
      })
    }
    throw error
  }
  if (probeFailure) {
    throw probeFailure.error
  }
  return persisted
}

export const PART_COMPAT_TRIGGER = `
  CREATE TRIGGER IF NOT EXISTS oco_message_part_compat_v1
  AFTER INSERT ON event
  WHEN NEW.type = 'message.part.updated.1'
  BEGIN
    INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
    SELECT json_extract(NEW.data, '$.part.id'), json_extract(NEW.data, '$.part.messageID'),
      json_extract(NEW.data, '$.part.sessionID'), json_extract(NEW.data, '$.time'),
      json_extract(NEW.data, '$.time'),
      json_remove(json_extract(NEW.data, '$.part'), '$.id', '$.messageID', '$.sessionID')
    WHERE EXISTS (
      SELECT 1 FROM message WHERE id = json_extract(NEW.data, '$.part.messageID')
        AND session_id = json_extract(NEW.data, '$.part.sessionID')
    )
    ON CONFLICT (id) DO UPDATE SET data = excluded.data, time_updated = excluded.time_updated;
  END;
`

export async function installMessagePersistenceCompat(
  command: string,
  env: NodeJS.ProcessEnv
): Promise<string> {
  const { stdout } = await runOpenCodeStep('OpenCode compatibility database path lookup', 15_000,
    ({ signal }) => runFile(command, ['db', 'path'], { env, signal }))
  const databasePath = stdout.trim()
  await installPartCompatTrigger(databasePath)
  return databasePath
}

export async function installPartCompatTrigger(databasePath: string): Promise<void> {
  if (!isAbsolute(databasePath) || !existsSync(databasePath)) {
    throw new Error('OpenCode compatibility requires an existing, absolute database path')
  }
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(databasePath, { open: true })
  const execWithLockRetry = async (sql: string) => {
    const deadline = Date.now() + 5_000
    let backoff = 50
    for (;;) {
      try {
        db.exec(sql)
        return
      } catch (error) {
        if (!(error instanceof Error) || !('errcode' in error) || error.errcode !== SQLITE_BUSY) throw error
        const remaining = deadline - Date.now()
        if (remaining <= 0) throw new Error('OpenCode compatibility database lock timed out after 5s')
        await delay(Math.min(remaining, backoff + Math.random() * backoff))
        backoff = Math.min(backoff * 2, 400)
      }
    }
  }
  try {
    await execWithLockRetry('BEGIN IMMEDIATE;')
    for (const [table, columns] of Object.entries({
      event: ['id', 'aggregate_id', 'seq', 'type', 'data'],
      message: ['id', 'session_id'],
      part: ['id', 'message_id', 'session_id', 'time_created', 'time_updated', 'data']
    })) {
      const schema = db.prepare(`PRAGMA table_info(${table})`).all()
      if (columns.some((column) => !schema.some((row) => row.name === column))) {
        throw new Error(`OpenCode compatibility does not support this ${table} schema`)
      }
    }
    // The trigger stores parts inside OpenCode's transaction, before its next history read
    db.exec(PART_COMPAT_TRIGGER)
    await execWithLockRetry('COMMIT;')
  } finally {
    db.close()
  }
}
