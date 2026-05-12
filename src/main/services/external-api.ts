import { app } from 'electron'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { writeFileSync, unlinkSync, existsSync, chmodSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { agentController, parseModelString } from './agent-controller'
import { runtimeManager } from './runtime-manager'
import { workspaceManager } from './workspace-manager'
import { database } from './database'
import { leaseRegistry } from './lease-registry'
import { notificationService } from './notification-service'
import { getAppVersion } from '../version'

/**
 * Localhost HTTP API for external tools (e.g. voice-prompt) to launch and
 * control OCO agents.  Bound to 127.0.0.1 only.
 *
 * Auth: every request needs `Authorization: Bearer <token>` where the token
 * is regenerated on each app start and written to the discovery file
 * (mode 0600 on POSIX so other users on the box can't read it).  This isn't
 * defense against a privileged local attacker, but it stops every
 * unprivileged process on the machine from hijacking OCO via a port scan.
 *
 * Identity: the public contract is keyed on `sessionId`, not OCO's internal
 * `agentId`.  This lets the same identifier flow into `opencode attach
 * --session <id>` without translation.
 *
 * Source attribution: clients send `X-OCO-Source` (e.g. "voice-prompt") and
 * the desktop notification surfaces it as "Voice prompt attached → my-project".
 * Falls back to "External" if absent.
 */

interface LaunchBody {
  dir?: string
  prompt?: string
  model?: string
  title?: string
  resume?: string
  [k: string]: unknown
}

interface PromptBody {
  text?: string
  model?: string
  [k: string]: unknown
}

const DISCOVERY_FILENAME = 'api.json'

// The discovery file is the only handshake mechanism for external clients
// (voice-prompt, etc.).  Check periodically that it still exists with our
// content, since cleanup tools or a second OCO instance exiting can silently
// remove it while the HTTP server is still running.
const DISCOVERY_RECHECK_INTERVAL_MS = 60_000

let server: Server | null = null
let actualPort = 0
let authToken = ''
let startedAt = 0
let discoveryRecheckTimer: NodeJS.Timeout | null = null

export async function startExternalApi(): Promise<void> {
  if (server) return

  authToken = randomBytes(32).toString('hex')
  startedAt = Date.now()
  server = createServer(handleRequest)

  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject)
    server!.listen(0, '127.0.0.1', () => {
      const address = server!.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to bind external API'))
        return
      }
      actualPort = address.port

      // Write the discovery file synchronously and verify it landed.  If the
      // write fails or the file isn't readable afterwards, the HTTP server
      // is undiscoverable — better to fail loudly than to keep running with
      // a "secret" port no client can find.
      try {
        writeDiscoveryFile()
      } catch (error) {
        // Clean up the listening socket so the caller can decide whether to
        // retry or surface the failure to the UI.
        server?.close()
        server = null
        actualPort = 0
        authToken = ''
        reject(error)
        return
      }

      startDiscoveryRecheckLoop()
      console.log(`[ExternalAPI] Listening on http://127.0.0.1:${actualPort}`)
      resolve()
    })
  })
}

export function stopExternalApi(): void {
  if (!server) return
  stopDiscoveryRecheckLoop()
  removeDiscoveryFile()
  server.close()
  server = null
  actualPort = 0
  authToken = ''
  startedAt = 0
}

function discoveryFilePath(): string {
  return join(app.getPath('userData'), DISCOVERY_FILENAME)
}

function buildDiscoveryPayload(): string {
  return JSON.stringify(
    {
      port: actualPort,
      pid: process.pid,
      startedAt,
      version: getAppVersion(),
      token: authToken
    },
    null,
    2
  )
}

function writeDiscoveryFile(): void {
  const path = discoveryFilePath()
  const payload = buildDiscoveryPayload()
  writeFileSync(path, payload, 'utf-8')
  // Restrict to owner-read/write only. The file contains an auth token.
  // chmod is a no-op on Windows but harmless.
  if (process.platform !== 'win32') {
    try { chmodSync(path, 0o600) } catch { /* best-effort */ }
  }
  // Read back to confirm the write actually landed. Catches cases like a
  // cleanup tool deleting the file between writeFileSync and the next read,
  // or a filesystem that silently swallowed the write.
  const readBack = readFileSync(path, 'utf-8')
  if (readBack !== payload) {
    throw new Error('Discovery file read-back did not match what was written')
  }
}

function startDiscoveryRecheckLoop(): void {
  stopDiscoveryRecheckLoop()
  discoveryRecheckTimer = setInterval(() => {
    if (!server) return
    const path = discoveryFilePath()
    let needsRewrite = false
    if (!existsSync(path)) {
      needsRewrite = true
    } else {
      try {
        if (readFileSync(path, 'utf-8') !== buildDiscoveryPayload()) needsRewrite = true
      } catch {
        needsRewrite = true
      }
    }
    if (!needsRewrite) return
    try {
      writeDiscoveryFile()
      console.warn(`[ExternalAPI] Discovery file disappeared or was modified; rewrote ${path}`)
    } catch (error) {
      // Don't tear down the HTTP server. We're already in a degraded state
      // and giving up on rewrites won't make it worse.
      console.error('[ExternalAPI] Failed to rewrite discovery file:', error)
    }
  }, DISCOVERY_RECHECK_INTERVAL_MS)
  // Allow the process to exit even if this timer is the only thing keeping
  // the event loop alive (e.g. during shutdown).
  discoveryRecheckTimer.unref()
}

function stopDiscoveryRecheckLoop(): void {
  if (discoveryRecheckTimer) {
    clearInterval(discoveryRecheckTimer)
    discoveryRecheckTimer = null
  }
}

function removeDiscoveryFile(): void {
  const path = discoveryFilePath()
  if (!existsSync(path)) return

  // Only delete the file if its contents match what we wrote. Otherwise a
  // second OCO instance shutting down would clobber a first instance's
  // discovery file, leaving the first instance listening on a port no
  // client can find.
  try {
    const current = readFileSync(path, 'utf-8')
    if (current !== buildDiscoveryPayload()) {
      console.warn(`[ExternalAPI] Discovery file at ${path} belongs to another instance; not removing`)
      return
    }
  } catch (error) {
    // If we can't read it we can't prove it's ours; leave it alone.
    console.warn('[ExternalAPI] Could not verify discovery file ownership before removal:', error)
    return
  }

  try {
    unlinkSync(path)
  } catch (error) {
    console.error('[ExternalAPI] Failed to remove discovery file:', error)
  }
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    await routeRequest(req, res)
  } catch (error) {
    console.error('[ExternalAPI] Unhandled error:', error)
    if (!res.headersSent) sendJson(res, 500, { error: 'internal_error', message: String(error) })
  }
}

async function routeRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? '/'
  const method = req.method ?? 'GET'

  // /health is public so callers can probe liveness without holding the
  // token (e.g. checking that OCO came back up after a restart).
  if (method === 'GET' && url === '/health') {
    return sendJson(res, 200, { ok: true, version: getAppVersion(), pid: process.pid })
  }

  // Every other endpoint is mutating or reveals session state — require
  // the discovery-file token.
  if (!isAuthorized(req)) return sendJson(res, 401, { error: 'unauthorized' })

  if (method === 'POST' && url === '/sessions') {
    const body = await readJsonBody<LaunchBody>(req)
    return handleLaunch(req, res, body)
  }

  const sessionMatch = url.match(/^\/sessions\/([^/]+)\/(prompt|abort)$/)
  if (method === 'POST' && sessionMatch) {
    const [, sessionId, action] = sessionMatch
    if (action === 'prompt') {
      const body = await readJsonBody<PromptBody>(req)
      return handleSessionPrompt(res, sessionId, body)
    }
    return handleSessionAbort(res, sessionId)
  }

  const leaseMatch = url.match(/^\/leases\/([^/]+)(?:\/(refresh))?$/)
  if (leaseMatch) {
    const [, leaseId, action] = leaseMatch
    if (method === 'POST' && action === 'refresh') return handleLeaseRefresh(res, leaseId)
    if (method === 'DELETE' && !action) return handleLeaseRelease(res, leaseId)
  }

  sendJson(res, 404, { error: 'not_found' })
}

function isAuthorized(req: IncomingMessage): boolean {
  const header = req.headers.authorization
  if (typeof header !== 'string') return false
  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match) return false
  // Constant-time comparison so we don't leak the token byte-by-byte over
  // request timing.  Length-equalize first since timingSafeEqual throws on
  // mismatched lengths.
  const provided = Buffer.from(match[1])
  const expected = Buffer.from(authToken)
  if (provided.length !== expected.length) return false
  return timingSafeEqual(provided, expected)
}

async function handleLaunch(
  req: IncomingMessage,
  res: ServerResponse,
  body: LaunchBody
): Promise<void> {
  const dir = (body.dir ?? '').trim()
  if (!dir) return sendJson(res, 400, { error: 'bad_request', message: 'dir is required' })

  // resume + prompt would be ambiguous: do we resume the conversation or
  // send a fresh first message?  Reject explicitly so callers don't think
  // both happened.  Send the prompt in a follow-up POST /sessions/:id/prompt.
  if (body.resume && (body.prompt ?? '').trim()) {
    return sendJson(res, 400, {
      error: 'bad_request',
      message: 'resume and prompt are mutually exclusive — POST /sessions/:sessionId/prompt after resuming'
    })
  }
  if (body.resume && body.model) {
    return sendJson(res, 400, {
      error: 'bad_request',
      message: 'resume and model are mutually exclusive — change models with POST /sessions/:sessionId/prompt'
    })
  }

  if (!workspaceManager.isGitRepo(dir)) {
    return sendJson(res, 400, {
      error: 'not_a_git_repo',
      message: `${dir} is not a git repository`
    })
  }

  // Normalize to the canonical repo root for both project persistence AND
  // the agent's directory.  Mirrors `LaunchModal.persistProjectSettings`
  // and matches what the README documents.
  const canonicalRoot = workspaceManager.getRepoRoot(dir)
  const name = canonicalRoot.split('/').filter(Boolean).pop() ?? canonicalRoot
  database.ensureProject(name, canonicalRoot)

  const source = readSourceHeader(req)

  const handle = body.resume
    ? await agentController.resumeAgent({
        directory: canonicalRoot,
        sessionId: body.resume,
        title: body.title
      })
    : await agentController.launchAgent({
        directory: canonicalRoot,
        prompt: body.prompt,
        title: body.title,
        model: body.model
      })

  const runtime = runtimeManager.getRuntime(handle.runtimeId)
  if (!runtime) {
    return sendJson(res, 500, { error: 'runtime_unavailable' })
  }

  const { id: agentId, sessionId, projectName } = handle
  const lease = leaseRegistry.acquire(canonicalRoot, sessionId, source)
  notificationService.notifyExternalAttached({ source, projectName, sessionId, agentId })

  sendJson(res, 200, {
    agentId,
    sessionId,
    runtimeUrl: runtime.serverUrl,
    directory: canonicalRoot,
    leaseId: lease.id,
    leaseExpiresAt: lease.expiresAt
  })
}

async function handleSessionPrompt(
  res: ServerResponse,
  sessionId: string,
  body: PromptBody
): Promise<void> {
  const text = (body.text ?? '').trim()
  if (!text) return sendJson(res, 400, { error: 'bad_request', message: 'text is required' })

  const agent = findAgentBySession(sessionId)
  if (!agent) return sendJson(res, 404, { error: 'session_not_found' })

  if (body.model) {
    const { providerID, modelID } = parseModelString(body.model)
    await agentController.sendMessageWithModel(agent.id, text, providerID, modelID)
  } else {
    await agentController.sendMessage(agent.id, text)
  }
  sendJson(res, 200, { ok: true })
}

async function handleSessionAbort(res: ServerResponse, sessionId: string): Promise<void> {
  const agent = findAgentBySession(sessionId)
  if (!agent) return sendJson(res, 404, { error: 'session_not_found' })
  await agentController.abortAgent(agent.id)
  sendJson(res, 200, { ok: true })
}

function handleLeaseRefresh(res: ServerResponse, leaseId: string): void {
  const lease = leaseRegistry.get(leaseId)
  if (!lease) return sendJson(res, 404, { error: 'lease_not_found_or_expired' })

  // Refuse to refresh leases whose underlying session no longer exists in
  // OCO (e.g. the agent was removed from the fleet).  Otherwise a stale
  // refresher could keep a future runtime for the same directory pinned
  // forever.
  if (!findAgentBySession(lease.sessionId)) {
    leaseRegistry.release(leaseId)
    return sendJson(res, 410, { error: 'session_gone' })
  }

  // We already validated the lease exists above, so refresh() can only fail
  // on a microsecond-level race with concurrent expiry.  Treat that as a
  // refresh-no-op rather than splitting the response with a second 404.
  const refreshed = leaseRegistry.refresh(leaseId) ?? lease
  sendJson(res, 200, { ok: true, expiresAt: refreshed.expiresAt })
}

function handleLeaseRelease(res: ServerResponse, leaseId: string): void {
  const removed = leaseRegistry.release(leaseId)
  sendJson(res, 200, { ok: removed })
}

function findAgentBySession(sessionId: string): { id: string } | undefined {
  return agentController.getAllAgents().find((handle) => handle.sessionId === sessionId)
}

function readSourceHeader(req: IncomingMessage): string {
  const raw = req.headers['x-oco-source']
  if (typeof raw === 'string' && raw.trim()) return raw.trim().slice(0, 64)
  return 'External'
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  let total = 0
  const limit = 1 << 20 // 1 MB cap — these payloads are tiny
  for await (const chunk of req) {
    const buf = chunk as Buffer
    total += buf.length
    if (total > limit) throw new Error('Request body too large')
    chunks.push(buf)
  }
  if (total === 0) return {} as T
  return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as T
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(payload))
}
