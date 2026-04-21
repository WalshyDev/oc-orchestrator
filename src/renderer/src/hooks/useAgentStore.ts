import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import type { AgentStatus } from '../types'
import type {
  OpenCodeEventPayload,
  AgentLaunchedPayload,
  AgentStatusesPayload,
  IpcResult,
  MessageAttachment,
  PermissionRequest as PermissionRequestPayload
} from '../types/api'
import { ensureProvidersLoaded, lookupContextLimit, subscribeToContextLimits } from './useModelOptions'

interface HistoricalMessageInfo {
  id: string
  sessionID: string
  role: 'user' | 'assistant'
  /** Present on AssistantMessage — the ID of the user message that triggered this response */
  parentID?: string
  time?: {
    created?: number
    completed?: number
  }
  modelID?: string
  cost?: number
  tokens?: {
    total?: number
    input: number
    output: number
    reasoning?: number
    cache?: {
      read?: number
      write?: number
    }
  }
  /** Present on AssistantMessage when the provider rejected or errored on the turn
   *  (e.g. ContextOverflowError, ProviderAuthError). */
  error?: {
    name?: string
    message?: string
    data?: unknown
  }
}

interface HistoricalMessagePart {
  id: string
  type: string
  text?: string
  tool?: string
  state?: {
    status?: string
    output?: string
    error?: string
    title?: string
    raw?: string
    input?: unknown
  }
  reasoning?: string
  reason?: string
  snapshot?: string
}

interface HistoricalSessionMessage {
  info: HistoricalMessageInfo
  parts: HistoricalMessagePart[]
}

// ── Agent State ──

export interface LiveAgent {
  id: string
  runtimeId: string
  sessionId: string
  directory: string
  name: string
  projectName: string
  branchName: string
  isWorktree: boolean
  workspaceName: string
  taskSummary: string
  status: AgentStatus
  labelIds: string[]
  model: string
  /** The model set by the user or first top-level assistant message.
   *  Used to restore the displayed model after an invoked agent
   *  (which may use a different model) finishes. */
  configuredModel?: string
  /** The currently selected model variant (thinking level). */
  variant?: string
  lastActivityAt: number
  blockedSince?: number
  prUrl: string | null
  cost: number
  tokens: { input: number; output: number }
  /** Approximate tokens consumed in the current context window — the number
   *  the provider will re-send on the next turn. Opencode reports tokens.total
   *  when available; we fall back to input + cache.read otherwise. Used with
   *  contextLimit to drive the ≥80% usage warning in the UI. */
  contextTokens?: number
  /** Provider-reported context window limit for the agent's current model.
   *  Populated from assistant message metadata; cleared when the model changes. */
  contextLimit?: number
  /** Raw modelID from the latest assistant message (e.g. "claude-sonnet-4-20250514").
   *  Used to look up the context limit from the provider cache. Separate from
   *  `model` (the formatted display name) and `configuredModel` (the setting). */
  rawModelId?: string
  /** Whether the name was auto-generated and should be replaced by the first prompt */
  autoNamed?: boolean
  /** Timestamp of last user response (sendMessage/replyToQuestion/respondToPermission).
   *  Used to guard against stale SSE events that would re-block the agent. */
  respondedAt?: number
  /** Most recent session-level error surfaced by the server (e.g. ContextOverflowError).
   *  Presence drives an error banner in the detail drawer; cleared by user dismiss
   *  or by a new successful assistant turn. */
  lastError?: LiveAgentError
  /** True while a compactSession RPC is in flight or the server has acknowledged
   *  compaction but session.compacted hasn't arrived yet. Drives the spinner and
   *  disabled states on the Compact buttons so the user can see progress. */
  compacting?: boolean
}

export interface LiveAgentError {
  /** Error name from the server (e.g. 'ContextOverflowError', 'ProviderAuthError'). */
  name: string
  message?: string
  /** Raw data payload from the server, surfaced for diagnostics. */
  data?: unknown
  sessionId: string
  occurredAt: number
}

export interface LivePermission {
  id: string
  agentId: string
  sessionId: string
  type: string
  title: string
  pattern?: string | string[]
  createdAt: number
}

export interface LiveQuestionOption {
  label: string
  description: string
}

export interface LiveQuestionInfo {
  question: string
  header: string
  options: LiveQuestionOption[]
  multiple?: boolean
  custom?: boolean
}

export interface LiveQuestion {
  id: string
  agentId: string
  sessionId: string
  questions: LiveQuestionInfo[]
  createdAt: number
}

export interface LiveMessage {
  id: string
  role: 'user' | 'assistant'
  sessionId: string
  createdAt: number
  parts: LiveMessagePart[]
}

export interface LiveMessagePart {
  id: string
  type: 'text' | 'tool' | 'reasoning' | 'step-start' | 'step-finish' | 'file' | 'compaction' | string
  text?: string
  toolName?: string
  toolState?: string
  toolInput?: string
  fileMime?: string
  fileUrl?: string
  fileName?: string
  /** For compaction parts — whether the compaction was auto-triggered by the server. */
  compactionAuto?: boolean
  /** For compaction parts — whether the compaction was triggered by a context overflow. */
  compactionOverflow?: boolean
}

export interface FileChangeRecord {
  path: string
  action: 'created' | 'modified' | 'deleted'
  timestamp: number
}

export interface EventLogEntry {
  id: string
  type: string
  summary: string
  timestamp: number
  data: unknown
}

// ── Store ──

interface AgentStoreState {
  agents: Map<string, LiveAgent>
  permissions: Map<string, LivePermission>
  questions: Map<string, LiveQuestion>
  messages: Map<string, LiveMessage[]> // keyed by sessionId
  fileChanges: Map<string, FileChangeRecord[]> // keyed by sessionId
  eventLog: Map<string, EventLogEntry[]> // keyed by sessionId
  healthy: boolean
  initializing: boolean
}

let state: AgentStoreState = {
  agents: new Map(),
  permissions: new Map(),
  questions: new Map(),
  messages: new Map(),
  fileChanges: new Map(),
  eventLog: new Map(),
  healthy: true,
  initializing: true
}

let eventCounter = 0

// Per-collection version counters. Incremented only when the corresponding Map
// is actually mutated, allowing downstream useMemo hooks to skip re-derivation
// when an SSE event only touches a different collection (e.g. a message update
// shouldn't re-create the agents array).
let agentsVersion = 0
let permissionsVersion = 0
let questionsVersion = 0
let messagesVersion = 0
let fileChangesVersion = 0
let eventLogVersion = 0

// Tracks agents whose taskSummary was set via an explicit override (e.g. "Create PR",
// "/review") so the SSE echo of the raw prompt text doesn't clobber the friendly label.
// Cleared when a server-generated session title arrives (which is a better summary).
const taskSummaryLocked = new Set<string>()

// Tracks agents that should have PR URL extraction enabled.  We only extract
// PR URLs when the user explicitly triggered the "Create PR" flow so that
// URLs the user pastes in their own messages don't get picked up.
const prExtractEnabled = new Set<string>()

// Messages queued while the agent is stopping, dispatched once the abort completes.
interface PendingMessage {
  text: string
  agentConfig?: string
  attachments?: MessageAttachment[]
  taskSummaryOverride?: string
}
const pendingMessages = new Map<string, PendingMessage>()

// Safety timers for the `compacting` flag. We set a short "kickoff" watchdog
// (30s): if the server doesn't produce a compaction part or set
// session.time.compacting within that window, the RPC effectively did
// nothing — clear the flag and surface an error so the user isn't staring at
// a spinner forever. Once real server evidence arrives (see below), the
// watchdog is cancelled because the session.compacted event will clear the
// flag authoritatively.
const compactingTimers = new Map<string, ReturnType<typeof setTimeout>>()
const COMPACTING_KICKOFF_TIMEOUT_MS = 30_000

/**
 * Fired when the kickoff watchdog expires without any server activity: the
 * RPC returned 200 but no compaction part or session.time.compacting update
 * arrived. Clears the spinner flag and surfaces an actionable banner error.
 */
function onCompactingWatchdogExpired(agentId: string): void {
  compactingTimers.delete(agentId)
  const agent = state.agents.get(agentId)
  if (!agent?.compacting) return
  console.warn('[compacting] kickoff watchdog fired — no server activity', agentId)
  agent.compacting = undefined
  agent.lastError = {
    name: 'CompactionNoResponse',
    message: 'Compaction request was accepted but the server hasn\'t produced any activity within 30 seconds. Try again, check the npm dev console for errors, or switch models.',
    sessionId: agent.sessionId,
    occurredAt: Date.now()
  }
  emit({ agents: true })
}

/**
 * Set or clear the agent's compacting flag. When setting true, also starts a
 * kickoff watchdog (see onCompactingWatchdogExpired). The watchdog is
 * cancelled by cancelCompactingWatchdog() once real server evidence arrives;
 * at that point the flag is authoritative and will be cleared by
 * session.compacted.
 */
function setCompacting(agentId: string, compacting: boolean): void {
  const agent = state.agents.get(agentId)
  if (!agent) return
  if (agent.compacting === compacting) return
  agent.compacting = compacting || undefined

  cancelCompactingWatchdog(agentId)

  if (compacting) {
    const timer = setTimeout(() => onCompactingWatchdogExpired(agentId), COMPACTING_KICKOFF_TIMEOUT_MS)
    compactingTimers.set(agentId, timer)
  }
  emit({ agents: true })
}

function cancelCompactingWatchdog(agentId: string): void {
  const existing = compactingTimers.get(agentId)
  if (existing) {
    clearTimeout(existing)
    compactingTimers.delete(agentId)
  }
}

/**
 * Fill in contextLimit for any agent whose rawModelId is now in the provider
 * cache but whose limit wasn't known when its messages were hydrated (typical
 * on cold start, where session messages arrive before the provider fetch).
 * Subscribed in the hook's useEffect to avoid touching useModelOptions during
 * module initialization — the two modules have a circular import via
 * formatModelName.
 */
function backfillContextLimits(): void {
  let changed = false
  for (const agent of state.agents.values()) {
    if (agent.contextLimit !== undefined || !agent.rawModelId) continue
    const limit = lookupContextLimit(agent.rawModelId)
    if (limit !== undefined) {
      agent.contextLimit = limit
      changed = true
    }
  }
  if (changed) emit({ agents: true })
}

// Tracks how many step-start parts (invoked sub-agents) are currently active
// per session. When depth > 0, message.updated model changes come from an
// invoked agent and should not overwrite the parent agent's displayed model.
const sessionStepDepth = new Map<string, number>()

/** Clear step depth for a session and restore the parent model if it was
 *  overwritten by a sub-agent. Returns true if the model was restored. */
function resetStepDepthAndRestoreModel(sessionId: string, agent: LiveAgent): boolean {
  if (!sessionStepDepth.delete(sessionId)) return false
  if (agent.configuredModel && agent.model !== agent.configuredModel) {
    agent.model = agent.configuredModel
    return true
  }
  return false
}

const listeners = new Set<() => void>()

interface EmitFlags {
  agents?: boolean
  permissions?: boolean
  questions?: boolean
  messages?: boolean
}

function emit(changed?: EmitFlags): void {
  if (!changed || changed.agents) agentsVersion++
  if (!changed || changed.permissions) permissionsVersion++
  if (!changed || changed.questions) questionsVersion++
  if (!changed || changed.messages) messagesVersion++
  state = { ...state }
  for (const listener of listeners) {
    listener()
  }
}

// Coalesced emit for high-frequency message updates. Mutations happen
// synchronously (so data is never lost), but React is only notified once
// per animation frame to avoid re-rendering the transcript dozens of
// times per second during agent streaming.
let pendingMessageEmit = false
let pendingAgentEmit = false

function emitMessagesThrottled(agentChanged: boolean): void {
  if (agentChanged) pendingAgentEmit = true

  if (!pendingMessageEmit) {
    pendingMessageEmit = true
    requestAnimationFrame(() => {
      pendingMessageEmit = false
      const flags: EmitFlags = { messages: true }
      if (pendingAgentEmit) {
        flags.agents = true
        pendingAgentEmit = false
      }
      emit(flags)
    })
  }
}

function persistAgentMeta(agentId: string, meta: { displayName?: string; taskSummary?: string; persistedStatus?: string; labelIds?: string[]; prUrl?: string }): void {
  window.api?.updateAgentMeta(agentId, meta)
}

/**
 * Derive a short kebab-case agent name from a prompt string.
 * Takes the first few meaningful words (up to 30 chars).
 */
function deriveNameFromPrompt(prompt: string): string {
  const cleaned = prompt
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .join('-')
    .toLowerCase()
    .replace(/-+/g, '-')
    .slice(0, 30)
    .replace(/-$/, '')
  return cleaned || 'agent'
}

function deriveFreshAgentName(projectName: string): string {
  const cleaned = projectName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .join('-')
    .slice(0, 24)
    .replace(/-$/, '')

  return cleaned ? `${cleaned}-fresh` : 'fresh-agent'
}

// ── PR URL Extraction ──

/** Matches GitHub and GitLab PR/MR URLs in message text. */
const PR_URL_REGEX = /https?:\/\/(?:github\.com|gitlab\.com|gitlab\.[a-z0-9.-]+)\S*\/(?:pull|merge_requests)\/\d+\b/gi

function extractPrUrl(text: string): string | null {
  const matches = text.match(PR_URL_REGEX)
  return matches ? matches[matches.length - 1] : null
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): AgentStoreState {
  return state
}

// ── Event Logging ──

function generateEventSummary(type: string, props: Record<string, unknown>): string {
  switch (type) {
    case 'session.status': {
      const statusInfo = props.status as Record<string, unknown> | undefined
      return `Session status changed to ${statusInfo?.type ?? 'unknown'}`
    }
    case 'session.idle':
      return 'Session became idle'
    case 'session.error':
      return 'Session encountered an error'
    case 'session.completed':
      return 'Session completed'
    case 'session.updated':
      return 'Session metadata updated'
    case 'message.updated':
      return `Message updated (role: ${(props.info as Record<string, unknown>)?.role ?? 'unknown'})`
    case 'message.part.updated': {
      const part = props.part as Record<string, unknown> | undefined
      const partType = part?.type as string | undefined
      if (partType === 'tool') {
        return `Tool call: ${part?.tool ?? 'unknown'}`
      }
      return `Message part updated (${partType ?? 'unknown'})`
    }
    case 'permission.asked':
      return `Permission requested: ${props.permission ?? props.title ?? props.type ?? 'unknown'}`
    case 'permission.replied':
      return 'Permission resolved'
    case 'question.asked': {
      const questions = props.questions as Array<{ header?: string }> | undefined
      return `Question asked: ${questions?.[0]?.header ?? 'unknown'}`
    }
    case 'question.replied':
      return 'Question answered'
    case 'question.rejected':
      return 'Question dismissed'
    case 'file.edited':
      return `File edited: ${props.file ?? props.path ?? 'unknown'}`
    case 'file.created':
      return `File created: ${props.file ?? props.path ?? 'unknown'}`
    case 'file.deleted':
      return `File deleted: ${props.file ?? props.path ?? 'unknown'}`
    case 'session.compacted':
      return 'Session context compacted'
    case 'message.removed':
      return `Message removed: ${props.messageID ?? 'unknown'}`
    case 'message.part.removed':
      return `Message part removed: ${props.partID ?? 'unknown'}`
    case 'server.instance.disposed':
      return `Server instance disposed: ${props.directory ?? 'unknown'}`
    case 'global.disposed':
      return 'Server process shutting down'
    case 'session.deleted':
      return 'Session deleted'
    case 'workspace.failed':
      return `Workspace failed: ${props.message ?? 'unknown error'}`
    case 'worktree.failed':
      return `Worktree failed: ${props.message ?? 'unknown error'}`
    case 'mcp.browser.open.failed':
      return `MCP auth failed to open browser for ${props.mcpName ?? 'unknown'}`
    case 'server.heartbeat':
      return 'Server heartbeat'
    default:
      return `Event: ${type}`
  }
}

const MAX_EVENT_LOG_ENTRIES = 500

function logEvent(sessionId: string, type: string, props: Record<string, unknown>): void {
  const entries = state.eventLog.get(sessionId) ?? []
  eventCounter += 1
  entries.push({
    id: `evt-${eventCounter}-${Date.now()}`,
    type,
    summary: generateEventSummary(type, props),
    timestamp: Date.now(),
    data: props
  })
  // Cap the log to prevent unbounded memory growth in long sessions
  if (entries.length > MAX_EVENT_LOG_ENTRIES) {
    entries.splice(0, entries.length - MAX_EVENT_LOG_ENTRIES)
  }
  state.eventLog.set(sessionId, entries)
  eventLogVersion++
}

function resolveSessionIdForEvent(
  props: Record<string, unknown>,
  runtimeId: string
): string | undefined {
  // Try to extract sessionId directly from properties
  const sessionId = props.sessionID as string | undefined
  if (sessionId) return sessionId

  // Try nested info object (message events)
  const info = props.info as Record<string, unknown> | undefined
  if (info?.sessionID) return info.sessionID as string
  if (info?.id) return info.id as string

  // Try nested part object (message part events)
  const part = props.part as Record<string, unknown> | undefined
  if (part?.sessionID) return part.sessionID as string

  // Fall back to finding agent by runtime
  const agent = findAgentByRuntime(runtimeId)
  return agent?.sessionId
}

function trackFileChange(sessionId: string, filePath: string, action: FileChangeRecord['action']): void {
  const changes = state.fileChanges.get(sessionId) ?? []
  changes.push({
    path: filePath,
    action,
    timestamp: Date.now()
  })
  state.fileChanges.set(sessionId, changes)
  fileChangesVersion++
}

function getMessageCreatedAt(info: Record<string, unknown> | HistoricalMessageInfo): number {
  const time = info.time as { created?: number } | undefined
  return typeof time?.created === 'number' ? time.created : Date.now()
}

function getToolState(partState: Record<string, unknown> | undefined): string | undefined {
  const status = partState?.status
  return typeof status === 'string' ? status : undefined
}

function stringifyToolInput(input: unknown): string | undefined {
  if (input === undefined) return undefined
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input)
  }
}

function getToolOutput(part: Record<string, unknown>, partState: Record<string, unknown> | undefined): string | undefined {
  const text = part.text
  if (typeof text === 'string' && text.trim()) return text

  const output = partState?.output
  if (typeof output === 'string' && output.trim()) return output

  const error = partState?.error
  if (typeof error === 'string' && error.trim()) return error

  const title = partState?.title
  if (typeof title === 'string' && title.trim()) return title

  const raw = partState?.raw
  if (typeof raw === 'string' && raw.trim()) return raw

  return undefined
}

function inferFileAction(before: string | undefined, after: string | undefined): FileChangeRecord['action'] {
  if (!before && after) return 'created'
  if (before && !after) return 'deleted'
  return 'modified'
}

// ── Optimistic User Messages ──

const OPTIMISTIC_PREFIX = 'optimistic-user-'
let optimisticCounter = 0

function injectOptimisticUserMessage(sessionId: string, text: string): void {
  if (!text.trim()) return
  const messages = state.messages.get(sessionId) ?? []
  const id = `${OPTIMISTIC_PREFIX}${++optimisticCounter}`
  messages.push({
    id,
    role: 'user',
    sessionId,
    createdAt: Date.now(),
    parts: [{ id: `${id}-part`, type: 'text', text }]
  })
  state.messages.set(sessionId, messages)
}

function removeOptimisticUserMessages(sessionId: string): void {
  const messages = state.messages.get(sessionId)
  if (!messages) return
  state.messages.set(sessionId, messages.filter((msg) => !msg.id.startsWith(OPTIMISTIC_PREFIX)))
}

function upsertMessage(message: LiveMessage): LiveMessage {
  const messages = state.messages.get(message.sessionId) ?? []
  const existingMessage = messages.find((candidate) => candidate.id === message.id)

  if (existingMessage) {
    existingMessage.role = message.role
    existingMessage.createdAt = message.createdAt
    return existingMessage
  }

  messages.push(message)
  messages.sort((left, right) => left.createdAt - right.createdAt)
  state.messages.set(message.sessionId, messages)
  return message
}

function upsertMessagePart(message: LiveMessage, nextPart: LiveMessagePart): void {
  const existingPart = message.parts.find((candidate) => candidate.id === nextPart.id)
  if (existingPart) {
    existingPart.type = nextPart.type
    existingPart.text = nextPart.text
    existingPart.toolName = nextPart.toolName
    existingPart.toolState = nextPart.toolState
    return
  }

  message.parts.push(nextPart)
}

function mapHistoricalPart(part: HistoricalMessagePart): LiveMessagePart {
  const nextPart: LiveMessagePart = {
    id: part.id,
    type: part.type,
    text: part.text ?? part.reasoning ?? part.reason ?? part.snapshot
  }

  if (part.type === 'tool') {
    nextPart.toolName = part.tool
    nextPart.toolState = part.state?.status
    nextPart.toolInput = stringifyToolInput(part.state?.input)
    nextPart.text = part.text ?? part.state?.output ?? part.state?.error ?? part.state?.title ?? part.state?.raw
  }

  if (part.type === 'file') {
    const filePart = part as unknown as Record<string, unknown>
    nextPart.fileMime = filePart.mime as string | undefined
    nextPart.fileUrl = filePart.url as string | undefined
    nextPart.fileName = filePart.filename as string | undefined
  }

  return nextPart
}

/** Identify assistant messages that belong to invoked sub-agents so their
 *  modelIDs can be excluded when determining the parent agent's displayed model.
 *
 *  A top-level assistant message contains step-start/step-finish parts, and its
 *  parentID points to a top-level user message. Any assistant whose parentID
 *  references a user message NOT in the top-level set is a sub-agent response. */
function identifySubAgentMessages(entries: HistoricalSessionMessage[]): Set<string> {
  const topLevelParentUserIds = new Set<string>()
  const allUserMessageIds = new Set<string>()
  const assistantParentIds = new Map<string, string>() // assistantId → parentID

  for (const entry of entries) {
    if (!entry?.info?.id) continue
    if (entry.info.role === 'user') {
      allUserMessageIds.add(entry.info.id)
    } else if (entry.info.role === 'assistant' && entry.info.parentID) {
      assistantParentIds.set(entry.info.id, entry.info.parentID)
      const hasStepPart = Array.isArray(entry.parts) &&
        entry.parts.some(p => p.type === 'step-start' || p.type === 'step-finish')
      if (hasStepPart) {
        topLevelParentUserIds.add(entry.info.parentID)
      }
    }
  }

  const subAgentIds = new Set<string>()
  if (topLevelParentUserIds.size > 0) {
    for (const [assistantId, parentId] of assistantParentIds) {
      if (allUserMessageIds.has(parentId) && !topLevelParentUserIds.has(parentId)) {
        subAgentIds.add(assistantId)
      }
    }
  }
  return subAgentIds
}

/**
 * Compute the number of tokens currently in the context window for a turn.
 * Prefers tokens.total when the provider reports it; otherwise approximates
 * with input + cache.read (what gets re-sent on the next request). Returns
 * undefined when we don't have enough data to estimate.
 */
function computeContextTokens(tokens: {
  total?: number
  input?: number
  cache?: { read?: number }
} | undefined): number | undefined {
  if (!tokens) return undefined
  if (typeof tokens.total === 'number') return tokens.total
  const input = tokens.input ?? 0
  const cacheRead = tokens.cache?.read ?? 0
  const sum = input + cacheRead
  return sum > 0 ? sum : undefined
}

function hydrateHistoricalMessages(entries: unknown): void {
  if (!Array.isArray(entries)) return

  const typed = entries as HistoricalSessionMessage[]
  const subAgentAssistantIds = identifySubAgentMessages(typed)
  const optimisticsCleaned = new Set<string>()

  // Track the last assistant entry per session so we can lift a persisted
  // error (e.g. ContextOverflowError) onto the agent after hydration. This
  // makes the error banner survive across app restarts — without it, the
  // user has to send another message to re-trigger the overflow just to see
  // the warning.
  const lastAssistantBySession = new Map<string, HistoricalMessageInfo>()

  for (const entry of typed) {
    if (!entry?.info?.id || !entry.info.sessionID || !Array.isArray(entry.parts)) continue

    // Real messages replace optimistic placeholders (once per session)
    if (entry.info.role === 'user' && !optimisticsCleaned.has(entry.info.sessionID)) {
      optimisticsCleaned.add(entry.info.sessionID)
      removeOptimisticUserMessages(entry.info.sessionID)
    }

    const createdAt = getMessageCreatedAt(entry.info)
    const message = upsertMessage({
      id: entry.info.id,
      role: entry.info.role,
      sessionId: entry.info.sessionID,
      createdAt,
      parts: []
    })

    for (const part of entry.parts) {
      if (!part?.id || !part.type) continue
      upsertMessagePart(message, mapHistoricalPart(part))
    }

    const agent = findAgentBySession(entry.info.sessionID)
    if (!agent) continue

    agent.lastActivityAt = Math.max(agent.lastActivityAt, createdAt)

    if (entry.info.role === 'assistant') {
      if (typeof entry.info.cost === 'number') {
        agent.cost = entry.info.cost
      }

      if (entry.info.tokens) {
        agent.tokens = {
          input: entry.info.tokens.input,
          output: entry.info.tokens.output
        }
        const ctx = computeContextTokens(entry.info.tokens)
        if (ctx !== undefined) agent.contextTokens = ctx
      }

      // Skip model updates from sub-agent messages (see identifySubAgentMessages)
      if (entry.info.modelID && !subAgentAssistantIds.has(entry.info.id)) {
        const formatted = formatModelName(entry.info.modelID)
        agent.model = formatted
        agent.rawModelId = entry.info.modelID
        const limit = lookupContextLimit(entry.info.modelID)
        if (limit !== undefined) {
          agent.contextLimit = limit
        } else {
          console.debug('[hydrate] no context limit found in cache', {
            agentId: agent.id,
            modelId: entry.info.modelID,
            hasTokens: !!entry.info.tokens,
            contextTokens: agent.contextTokens
          })
        }
        // Only seed configuredModel if not already set by a config fetch or
        // prior setAgentModel call, so the authoritative config value wins.
        if (!agent.configuredModel) {
          agent.configuredModel = formatted
        }
      }

      // PR URLs are only extracted during the live "Create PR" flow and
      // persisted to preferences, so historical messages are not scanned.
      // This avoids picking up URLs the user pasted in their own prompts.

      // Track latest assistant message per session for post-hydration error
      // surfacing (see loop below).
      const prev = lastAssistantBySession.get(entry.info.sessionID)
      if (!prev || getMessageCreatedAt(entry.info) > getMessageCreatedAt(prev)) {
        lastAssistantBySession.set(entry.info.sessionID, entry.info)
      }
    }
  }

  // Surface persisted errors on the most recent assistant message as the
  // agent's lastError. Only when the user hasn't already seen/dismissed it
  // (agent.lastError empty) and when there's no later successful user
  // message that would supersede it.
  for (const [sessionId, info] of lastAssistantBySession) {
    if (!info.error?.name) continue
    const agent = findAgentBySession(sessionId)
    if (!agent || agent.lastError) continue
    console.log('[hydrateHistoricalMessages] surfacing persisted error on agent', {
      agentId: agent.id,
      errorName: info.error.name,
      errorMessage: info.error.message
    })
    agent.lastError = {
      name: info.error.name,
      message: info.error.message,
      data: info.error.data,
      sessionId,
      occurredAt: info.time?.completed ?? info.time?.created ?? Date.now()
    }
  }
}

// ── Viewed Agent Suppression ──

let viewedAgentId: string | null = null

export function setViewedAgentId(agentId: string | null): void {
  viewedAgentId = agentId
}

// ── Event Processing ──

const NOTIFIABLE_STATUSES = new Set(['needs_approval', 'needs_input', 'errored', 'completed', 'disconnected', 'idle'])

const MAX_PREVIEW_LENGTH = 200

function getLastAssistantPreview(sessionId: string): string | undefined {
  const messages = state.messages.get(sessionId)
  if (!messages) return undefined

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== 'assistant') continue

    const fullText = msg.parts
      .filter((p) => p.type === 'text' && p.text)
      .map((p) => p.text!)
      .join(' ')
      .trim()

    if (fullText.length === 0) continue
    return fullText.length > MAX_PREVIEW_LENGTH
      ? fullText.slice(0, MAX_PREVIEW_LENGTH) + '…'
      : fullText
  }
  return undefined
}

function notifyIfNeeded(agent: LiveAgent, newStatus: string): void {
  if (agent.status === newStatus) return
  if (!NOTIFIABLE_STATUSES.has(newStatus)) return

  // Don't notify for the agent whose transcript is currently open
  if (agent.id === viewedAgentId) return

  // Treat running→idle as "completed" for notification purposes
  const notifyStatus = (newStatus === 'idle' && agent.status === 'running') ? 'completed' : newStatus
  if (notifyStatus === 'idle') return // only notify idle when coming from running

  const preview = getLastAssistantPreview(agent.sessionId)
  window.api?.notifyAgentStatus(agent.id, notifyStatus, agent.name, agent.projectName, preview)
}

function processEvent(payload: OpenCodeEventPayload): void {
  const { runtimeId, event } = payload
  const { type, properties } = event
  const props = properties as Record<string, unknown>

  // Log every event to the event log
  const resolvedSessionId = resolveSessionIdForEvent(props, runtimeId)
  if (resolvedSessionId && type !== 'server.heartbeat') {
    logEvent(resolvedSessionId, type, props)
  }

  switch (type) {
    case 'session.status': {
      const sessionId = props.sessionID as string
      const statusInfo = props.status as { type: string }
      const agent = findAgentBySession(sessionId)
      if (agent) {
        const newStatus = mapSessionStatus(statusInfo.type)
        // While stopping, only allow transitions to terminal states (idle/completed/errored).
        // Ignore 'running' or 'needs_input' events that may arrive after abort was sent.
        if (agent.status === 'stopping' && newStatus !== 'idle' && newStatus !== 'completed' && newStatus !== 'errored') {
          break
        }
        // After the user responds, ignore stale 'waiting' status events that were
        // in-flight before the server processed the reply. Without this guard the
        // agent flips back to needs_input/needs_approval and the banner stays blocked.
        if ((newStatus === 'needs_input' || newStatus === 'needs_approval') && isWithinOptimisticGuard(agent)) {
          break
        }
        // Don't let a 'busy' status clobber needs_input/needs_approval when there are
        // still pending questions or permissions. The server can send session.status 'busy'
        // after question.asked due to event ordering; without this guard the agent appears
        // to go back to 'running' and the user never sees the question card.
        if (
          (agent.status === 'needs_input' || agent.status === 'needs_approval') &&
          newStatus === 'running' &&
          agentHasPendingInterrupts(agent.id)
        ) {
          break
        }
        if (agent.status !== newStatus) {
          const wasStopping = agent.status === 'stopping'
          notifyIfNeeded(agent, newStatus)
          agent.status = newStatus
          agent.lastActivityAt = Date.now()
          if (newStatus === 'needs_input' || newStatus === 'needs_approval') {
            agent.blockedSince = agent.blockedSince ?? Date.now()
          } else {
            agent.blockedSince = undefined
            agent.respondedAt = undefined
          }
          if (newStatus === 'completed') {
            persistAgentMeta(agent.id, { persistedStatus: 'completed' })
          }
          emit({ agents: true })

          if (wasStopping && newStatus === 'idle') {
            dispatchPendingMessage(agent.id)
          }
        }
      }
      break
    }

    case 'session.idle': {
      const sessionId = props.sessionID as string
      const agent = findAgentBySession(sessionId)
      if (agent) {
        notifyIfNeeded(agent, 'idle')
        agent.status = 'idle'
        agent.lastActivityAt = Date.now()
        agent.blockedSince = undefined
        agent.respondedAt = undefined
        prExtractEnabled.delete(agent.id)
        resetStepDepthAndRestoreModel(sessionId, agent)

        // Deliberately DO NOT clear lastError or lastDispatchedMessage here.
        // The opencode server emits session.error immediately followed by
        // session.idle, and if we wiped the recovery state on idle the error
        // banner would flash and disappear before the user could act on it.
        // These are cleared on successful assistant output or explicit user
        // action (dismiss, new send, compact-and-retry).

        persistAgentMeta(agent.id, { persistedStatus: 'idle' })
        emit({ agents: true })
        dispatchPendingMessage(agent.id)
      }
      break
    }

    case 'session.error': {
      const sessionId = props.sessionID as string
      const errorProp = props.error as { name?: string; message?: string; data?: unknown } | undefined
      console.error('[session.error]', { sessionId, error: errorProp, fullProps: props })
      const agent = findAgentBySession(sessionId)
      if (agent) {
        notifyIfNeeded(agent, 'errored')
        agent.status = 'errored'
        agent.lastActivityAt = Date.now()
        agent.respondedAt = undefined
        prExtractEnabled.delete(agent.id)
        resetStepDepthAndRestoreModel(sessionId, agent)

        // Surface the error so the UI can render a banner.
        if (errorProp?.name) {
          agent.lastError = {
            name: errorProp.name,
            message: errorProp.message,
            data: errorProp.data,
            sessionId,
            occurredAt: Date.now()
          }
        }

        persistAgentMeta(agent.id, { persistedStatus: 'errored' })
        emit({ agents: true })
      }
      break
    }

    case 'session.completed': {
      const sessionId = props.sessionID as string
      const agent = findAgentBySession(sessionId)
      if (agent) {
        notifyIfNeeded(agent, 'completed')
        agent.status = 'completed'
        agent.lastActivityAt = Date.now()
        agent.blockedSince = undefined
        agent.respondedAt = undefined
        prExtractEnabled.delete(agent.id)
        resetStepDepthAndRestoreModel(sessionId, agent)

        persistAgentMeta(agent.id, { persistedStatus: 'completed' })
        emit({ agents: true })
        dispatchPendingMessage(agent.id)
      }
      break
    }

    case 'tui.toast.show': {
      // Opencode's TUI toasts are the canonical channel for provider and
      // compactor errors. Surface error-variant toasts on the best-guess
      // agent for the runtime (toasts don't carry a sessionID).
      const toast = props as { title?: string; message?: string; variant?: string }
      console.log('[tui.toast.show]', { runtimeId, variant: toast.variant, title: toast.title, message: toast.message })

      if (toast.variant !== 'error' && toast.variant !== 'warning') break

      const target = pickToastTargetAgent(runtimeId)
      if (!target) {
        console.warn('[tui.toast.show] no agent for runtime', { runtimeId })
        break
      }

      if (toast.variant === 'error') {
        console.error('[tui.toast.show error]', {
          runtimeId,
          targetAgent: target.id,
          wasCompacting: !!target.compacting,
          toast
        })
        target.lastError = {
          name: toast.title || 'Server error',
          message: toast.message,
          sessionId: target.sessionId,
          occurredAt: Date.now()
        }
        target.lastActivityAt = Date.now()
        // Compactor errors (e.g. "prompt is too long") arrive here. Stop the
        // spinner so the banner flips from "Compacting…" to the error state.
        if (target.compacting) setCompacting(target.id, false)
        emit({ agents: true })
      } else {
        // Warnings: log only — we don't want to hijack the banner for a warning.
        console.warn('[tui.toast.show warning]', { runtimeId, targetAgent: target.id, toast })
      }
      break
    }

    case 'session.updated': {
      const info = props.info as Record<string, unknown> | undefined
      const sessionId = info?.id as string | undefined
      if (!sessionId) break
      const agent = findAgentBySession(sessionId)
      if (agent) {
        const time = info?.time as { updated?: number; compacting?: number } | undefined
        agent.lastActivityAt = typeof time?.updated === 'number' ? time.updated : Date.now()

        // The server sets session.time.compacting to a timestamp while
        // compaction is in progress and clears it when done. This is the
        // authoritative signal — cancel the kickoff watchdog when the server
        // takes ownership of the flag.
        const serverIsCompacting = typeof time?.compacting === 'number'
        if (serverIsCompacting) {
          if (!agent.compacting) {
            console.log('[session.updated] server started compacting', { agentId: agent.id, at: time?.compacting })
          }
          cancelCompactingWatchdog(agent.id)
          if (!agent.compacting) setCompacting(agent.id, true)
        } else if (agent.compacting && !compactingTimers.has(agent.id)) {
          // Server has explicitly cleared its compacting timestamp and we're
          // past the kickoff window — compaction finished (or was cancelled)
          // but session.compacted didn't fire. Clear our flag to match.
          console.log('[session.updated] server cleared compacting without session.compacted event', { agentId: agent.id })
          setCompacting(agent.id, false)
        }

        const title = info?.title as string | undefined
        // Only use the server-generated session title for the initial summary
        // (when taskSummary is still a placeholder). Once the user has sent a
        // message, their latest prompt is more relevant than the session title
        // which tends to reflect only the first message.
        const isPlaceholder = agent.taskSummary.endsWith('waiting for prompt...')
        if (title && !title.match(/^agent-\d+(-\d+)?$/) && isPlaceholder && !taskSummaryLocked.has(agent.id)) {
          agent.taskSummary = title.slice(0, 120)
          persistAgentMeta(agent.id, { taskSummary: agent.taskSummary })
        }
        emit({ agents: true })
      }
      break
    }

    case 'message.updated': {
      const info = props.info as Record<string, unknown>
      const sessionId = info.sessionID as string
      const messageId = info.id as string
      const role = info.role as 'user' | 'assistant'
      const createdAt = getMessageCreatedAt(info)

      let agentChanged = false
      const agent = findAgentBySession(sessionId)
      if (agent) {
        // lastActivityAt is intentionally not tracked via agentChanged — it feeds
        // the "Xs ago" display which already refreshes on a 30s timer. Tracking it
        // here would bump agentsVersion on every message event, defeating the
        // optimization for typing responsiveness.
        agent.lastActivityAt = Date.now()

        // Update cost/tokens from assistant messages
        if (role === 'assistant') {
          const cost = info.cost as number | undefined
          const tokens = info.tokens as {
            total?: number
            input: number
            output: number
            cache?: { read?: number; write?: number }
          } | undefined
          if (cost !== undefined) { agent.cost = cost; agentChanged = true }
          if (tokens) {
            agent.tokens = { input: tokens.input, output: tokens.output }
            const ctx = computeContextTokens(tokens)
            if (ctx !== undefined) agent.contextTokens = ctx
            agentChanged = true
          }

          // Only update model from top-level (non-invoked) assistant messages
          const modelId = info.modelID as string | undefined
          const depth = sessionStepDepth.get(sessionId) ?? 0
          if (modelId && depth === 0) {
            const formatted = formatModelName(modelId)
            agent.model = formatted
            agent.configuredModel = formatted
            agent.rawModelId = modelId
            const limit = lookupContextLimit(modelId)
            if (limit !== undefined) agent.contextLimit = limit
            agentChanged = true
          }

          // Opencode reports provider errors on the assistant message itself via
          // the `error` field. Capture that here — it's the canonical place for
          // ContextOverflowError and similar — since the separate session.error
          // event doesn't always fire reliably.
          const msgError = info.error as { name?: string; message?: string; data?: unknown } | undefined
          if (msgError?.name) {
            console.error('[message.updated] assistant message carries error', {
              agentId: agent.id,
              sessionId,
              messageId,
              errorName: msgError.name,
              errorMessage: msgError.message,
              errorData: msgError.data
            })
            agent.lastError = {
              name: msgError.name,
              message: msgError.message,
              data: msgError.data,
              sessionId,
              occurredAt: Date.now()
            }
            agentChanged = true
          }

          // Only clear a sticky error when we see a truly completed assistant
          // message with no error attached. `message.updated` also fires for the
          // placeholder shell before the provider responds, which is when the
          // overflow error lands — clearing on every update would erase the
          // banner before the user sees it.
          const time = info.time as { completed?: number } | undefined
          const messageComplete = typeof time?.completed === 'number' && !msgError
          if (messageComplete && agent.lastError) {
            agent.lastError = undefined
            agentChanged = true
          }
        }
      }

      // When the server-authoritative user message arrives, drop any
      // optimistic placeholder we injected earlier so it doesn't duplicate.
      if (role === 'user') {
        removeOptimisticUserMessages(sessionId)
      }

      // Store message
      const messages = state.messages.get(sessionId) ?? []
      const existing = messages.find((msg) => msg.id === messageId)
      if (!existing) {
        messages.push({
          id: messageId,
          role,
          sessionId,
          createdAt,
          parts: []
        })
        state.messages.set(sessionId, messages)
      } else {
        existing.createdAt = createdAt
        existing.role = role
      }

      emit({ messages: true, agents: agentChanged })
      break
    }

    case 'message.part.updated': {
      const part = props.part as Record<string, unknown>
      const sessionId = part.sessionID as string
      const messageId = part.messageID as string
      const partId = part.id as string
      const partType = part.type as string

      // A `compaction` part is the server's authoritative signal that the
      // compactor is actively running for this session. Cancel the kickoff
      // watchdog (compaction has demonstrably started) and set the spinner
      // flag for auto-compactions that the user didn't initiate.
      if (partType === 'compaction') {
        const agent = findAgentBySession(sessionId)
        if (agent) {
          console.log('[compaction part] server acknowledged compaction', { agentId: agent.id, auto: part.auto })
          cancelCompactingWatchdog(agent.id)
          if (!agent.compacting) setCompacting(agent.id, true)
        }
      }

      // Track invoked-agent nesting depth so model updates from sub-agents
      // don't overwrite the parent agent's displayed model.
      let modelRestored = false
      if (partType === 'step-start') {
        sessionStepDepth.set(sessionId, (sessionStepDepth.get(sessionId) ?? 0) + 1)
      } else if (partType === 'step-finish') {
        const current = sessionStepDepth.get(sessionId) ?? 0
        if (current > 1) {
          sessionStepDepth.set(sessionId, current - 1)
        } else if (current === 1) {
          const agent = findAgentBySession(sessionId)
          if (agent) modelRestored = resetStepDepthAndRestoreModel(sessionId, agent)
        }
        // current === 0: no matching step-start, ignore
      }

      const messages = state.messages.get(sessionId) ?? []
      const message = messages.find((msg) => msg.id === messageId)

      if (message) {
        const existingPart = message.parts.find((partItem) => partItem.id === partId)
        const toolState = part.state as Record<string, unknown> | undefined

        // Extract text content — for reasoning parts, also check 'reasoning' and 'content' fields
        const extractText = (): string | undefined => {
          if (partType === 'reasoning') {
            const text = part.text ?? part.reasoning ?? part.content
            return typeof text === 'string' ? text : undefined
          }
          return getToolOutput(part, toolState) ?? part.text as string | undefined
        }

        const partText = extractText()
        if (existingPart) {
          existingPart.text = partText
          if (partType === 'tool') {
            existingPart.toolState = getToolState(toolState)
            existingPart.toolInput = stringifyToolInput(toolState?.input)
          }
          if (partType === 'file') {
            existingPart.fileMime = part.mime as string | undefined
            existingPart.fileUrl = part.url as string | undefined
            existingPart.fileName = part.filename as string | undefined
          }
        } else {
          const newPart: LiveMessagePart = {
            id: partId,
            type: partType,
            text: partText
          }
          if (partType === 'tool') {
            newPart.toolName = part.tool as string | undefined
            newPart.toolState = getToolState(toolState)
            newPart.toolInput = stringifyToolInput(toolState?.input)
          }
          if (partType === 'file') {
            newPart.fileMime = part.mime as string | undefined
            newPart.fileUrl = part.url as string | undefined
            newPart.fileName = part.filename as string | undefined
          }
          if (partType === 'compaction') {
            newPart.compactionAuto = part.auto as boolean | undefined
            newPart.compactionOverflow = part.overflow as boolean | undefined
          }
          message.parts.push(newPart)
        }

        // Update agent activity (but don't clobber blocked/stopping/terminal states)
        let agentChanged = false
        const agent = findAgentBySession(sessionId)
        if (agent) {
          // Extract PR URL from assistant text and tool output parts, but only
          // when the "Create PR" flow was explicitly triggered by the user.
          if (prExtractEnabled.has(agent.id) && message.role === 'assistant' && (partType === 'text' || partType === 'tool') && partText) {
            const prUrl = extractPrUrl(partText)
            if (prUrl && agent.prUrl !== prUrl) {
              agent.prUrl = prUrl
              agentChanged = true
              persistAgentMeta(agent.id, { prUrl })
            }
          }
          agent.lastActivityAt = Date.now()
          if (agent.status !== 'needs_input' && agent.status !== 'needs_approval' && agent.status !== 'stopping' && agent.status !== 'completed' && agent.status !== 'idle') {
            agent.status = 'running'
            agent.blockedSince = undefined
          }

          // Update task summary from first user text part, unless an override
          // label is active (e.g. "Create PR" or a slash command).
          if (message.role === 'user' && partType === 'text' && part.text) {
            const text = part.text as string
            if (text.length > 0) {
              if (!taskSummaryLocked.has(agent.id)) {
                agent.taskSummary = text.slice(0, 120)
              }

              // Auto-name the agent from the first prompt if no explicit name was given
              if (agent.autoNamed) {
                agent.name = deriveNameFromPrompt(text)
                agent.autoNamed = false
              }

              persistAgentMeta(agent.id, { displayName: agent.name, taskSummary: agent.taskSummary })
              agentChanged = true
            }
          }
        }

        emitMessagesThrottled(agentChanged || modelRestored)
      } else if (modelRestored) {
        // step-finish arrived before the parent message exists locally —
        // still need to emit so the restored model is picked up by the UI.
        emit({ agents: true })
      }
      break
    }

    case 'permission.asked': {
      const permissionId = props.id as string
      const sessionId = props.sessionID as string
      // v2 SDK sends 'permission' (e.g. "read", "write", "bash"), fall back to legacy 'type'
      const permType = (props.permission ?? props.type) as string
      const patterns = props.patterns as string[] | undefined
      const metadata = props.metadata as Record<string, unknown> | undefined

      // Derive a human-readable title from the permission type + patterns
      const title = (metadata?.title as string | undefined)
        ?? (patterns?.length ? `${permType}: ${patterns.join(', ')}` : permType)

      // Try session-based lookup first, fall back to runtime-based lookup
      // in case the sessionID doesn't match (e.g. event ordering race)
      const agent = findAgentBySession(sessionId) ?? findAgentByRuntime(runtimeId)
      if (agent) {
        notifyIfNeeded(agent, 'needs_approval')

        agent.status = 'needs_approval'
        agent.blockedSince = agent.blockedSince ?? Date.now()
        agent.lastActivityAt = Date.now()
        // A new permission request means the server has moved on from whatever
        // the user previously responded to, so clear the guard.
        agent.respondedAt = undefined

        state.permissions.set(permissionId, {
          id: permissionId,
          agentId: agent.id,
          sessionId,
          type: permType,
          title,
          pattern: patterns,
          createdAt: Date.now()
        })

        emit({ agents: true, permissions: true })
      }
      break
    }

    case 'permission.replied': {
      const permissionId = (props.requestID ?? props.permissionID) as string
      state.permissions.delete(permissionId)

      const sessionId = props.sessionID as string
      const agent = findAgentBySession(sessionId)
      if (agent) {
        if (agent.status !== 'stopping') {
          agent.status = 'running'
          agent.blockedSince = undefined
        }
        agent.lastActivityAt = Date.now()

      }

      emit({ agents: true, permissions: true })
      break
    }

    case 'question.asked': {
      const requestId = props.id as string
      const sessionId = props.sessionID as string
      const questions = props.questions as LiveQuestionInfo[] | undefined

      // Try session-based lookup first, fall back to runtime-based lookup
      // in case the sessionID doesn't match (e.g. event ordering race)
      const agent = findAgentBySession(sessionId) ?? findAgentByRuntime(runtimeId)
      if (agent && questions) {
        notifyIfNeeded(agent, 'needs_input')

        agent.status = 'needs_input'
        agent.blockedSince = agent.blockedSince ?? Date.now()
        agent.lastActivityAt = Date.now()
        // A new question means the server has moved on, so clear the guard.
        agent.respondedAt = undefined

        state.questions.set(requestId, {
          id: requestId,
          agentId: agent.id,
          sessionId: sessionId ?? agent.sessionId,
          questions,
          createdAt: Date.now()
        })

        emit({ agents: true, questions: true })
      }
      break
    }

    case 'question.replied': {
      const requestId = props.requestID as string
      state.questions.delete(requestId)

      const sessionId = props.sessionID as string
      const agent = findAgentBySession(sessionId)
      if (agent) {
        if (agent.status !== 'stopping') {
          agent.status = 'running'
          agent.blockedSince = undefined
        }
        agent.lastActivityAt = Date.now()

      }

      emit({ agents: true, questions: true })
      break
    }

    case 'question.rejected': {
      const requestId = props.requestID as string
      state.questions.delete(requestId)

      const sessionId = props.sessionID as string
      const agent = findAgentBySession(sessionId)
      if (agent) {
        if (agent.status !== 'stopping') {
          agent.status = 'running'
          agent.blockedSince = undefined
        }
        agent.lastActivityAt = Date.now()

      }

      emit({ agents: true, questions: true })
      break
    }

    case 'session.diff': {
      const sessionId = props.sessionID as string
      const diffs = props.diff as Array<Record<string, unknown>> | undefined
      const agent = findAgentBySession(sessionId)
      if (agent && Array.isArray(diffs)) {
        agent.lastActivityAt = Date.now()
        for (const diff of diffs) {
          const filePath = diff.file as string | undefined
          if (!filePath) continue
          trackFileChange(
            sessionId,
            filePath,
            inferFileAction(diff.before as string | undefined, diff.after as string | undefined)
          )
        }
        emit({ agents: true })
      }
      break
    }

    case 'file.edited': {
      // Track file activity and record the change
      const agent = findAgentByRuntime(runtimeId)
      if (agent) {
        agent.lastActivityAt = Date.now()
        const filePath = (props.file ?? props.path ?? 'unknown') as string
        trackFileChange(agent.sessionId, filePath, 'modified')
        emit({ agents: true })
      }
      break
    }

    case 'file.watcher.updated': {
      const agent = findAgentByRuntime(runtimeId)
      if (agent) {
        agent.lastActivityAt = Date.now()
        const filePath = props.file as string | undefined
        const eventName = props.event as string | undefined
        if (filePath) {
          const action = eventName === 'add'
            ? 'created'
            : eventName === 'unlink'
              ? 'deleted'
              : 'modified'
          trackFileChange(agent.sessionId, filePath, action)
        }
        emit({ agents: true })
      }
      break
    }

    case 'vcs.branch.updated': {
      const branch = props.branch as string | undefined
      if (!branch) break
      for (const agent of state.agents.values()) {
        if (agent.runtimeId === runtimeId) {
          agent.branchName = branch
          agent.lastActivityAt = Date.now()
        }
      }
      emit({ agents: true })
      break
    }

    case 'file.created': {
      const agent = findAgentByRuntime(runtimeId)
      if (agent) {
        agent.lastActivityAt = Date.now()
        const filePath = (props.file ?? props.path ?? 'unknown') as string
        trackFileChange(agent.sessionId, filePath, 'created')
        emit({ agents: true })
      }
      break
    }

    case 'file.deleted': {
      const agent = findAgentByRuntime(runtimeId)
      if (agent) {
        agent.lastActivityAt = Date.now()
        const filePath = (props.file ?? props.path ?? 'unknown') as string
        trackFileChange(agent.sessionId, filePath, 'deleted')
        emit({ agents: true })
      }
      break
    }

    case 'session.compacted': {
      // The server compacted the session's context window — old messages and
      // parts were pruned server-side. Clear local messages so the UI doesn't
      // show ghost messages that the agent can no longer reference, then
      // re-fetch the post-compaction transcript.
      const sessionId = props.sessionID as string
      const agent = findAgentBySession(sessionId)
      console.log('[session.compacted] received', { sessionId, agentId: agent?.id })
      if (agent) {
        state.messages.delete(sessionId)
        agent.lastActivityAt = Date.now()
        // Compaction resolves ContextOverflowError — the context window now
        // has room for the replayed transcript, so clear the banner.
        if (agent.lastError?.name === 'ContextOverflowError') {
          agent.lastError = undefined
        }
        setCompacting(agent.id, false)
        emit({ agents: true, messages: true })
        void refetchSessionMessages(agent.id)
      }
      break
    }

    case 'message.removed': {
      // A message was deleted from the session (compaction, revert, undo).
      // Remove it from local state so the UI stays in sync.
      const sessionId = props.sessionID as string
      const messageId = props.messageID as string
      const messages = state.messages.get(sessionId)
      if (messages) {
        const index = messages.findIndex((msg) => msg.id === messageId)
        if (index !== -1) {
          messages.splice(index, 1)
          emit({ messages: true })
        }
      }
      break
    }

    case 'message.part.removed': {
      // A specific part (tool call, text block, etc.) was removed from a message.
      // Remove it from local state so reverted/deleted parts disappear from the UI.
      const sessionId = props.sessionID as string
      const messageId = props.messageID as string
      const partId = props.partID as string
      const messages = state.messages.get(sessionId)
      if (messages) {
        const message = messages.find((msg) => msg.id === messageId)
        if (message) {
          const partIndex = message.parts.findIndex((part) => part.id === partId)
          if (partIndex !== -1) {
            message.parts.splice(partIndex, 1)
            emit({ messages: true })
          }
        }
      }
      break
    }

    case 'server.instance.disposed': {
      // The OpenCode server for a specific project directory is shutting down.
      // Mark all agents on this runtime as disconnected so the user knows the
      // server went away (EventBridge will attempt reconnection).
      for (const agent of state.agents.values()) {
        if (agent.runtimeId === runtimeId) {
          // Don't override terminal states — if the agent already completed
          // before the server shut down, leave it as completed.
          if (agent.status === 'completed' || agent.status === 'errored') continue
          agent.status = 'disconnected'
          agent.lastActivityAt = Date.now()
          agent.blockedSince = undefined
          agent.respondedAt = undefined
        }
      }
      state.healthy = false
      emit({ agents: true })
      break
    }

    case 'global.disposed': {
      // The entire OpenCode process is shutting down — all agents on this
      // runtime should transition to disconnected.
      for (const agent of state.agents.values()) {
        if (agent.runtimeId === runtimeId) {
          if (agent.status === 'completed' || agent.status === 'errored') continue
          agent.status = 'disconnected'
          agent.lastActivityAt = Date.now()
          agent.blockedSince = undefined
          agent.respondedAt = undefined
        }
      }
      state.healthy = false
      emit({ agents: true })
      break
    }

    case 'session.deleted': {
      // A session was deleted (from another client, or server cleanup).
      // Transition the bound agent to errored so the user knows the session
      // is gone and any further interaction would fail.
      const sessionId = props.sessionID as string
      const agent = findAgentBySession(sessionId)
      if (agent) {
        agent.status = 'errored'
        agent.taskSummary = 'Session deleted externally'
        agent.lastActivityAt = Date.now()
        agent.blockedSince = undefined
        agent.respondedAt = undefined

        // Clean up any pending questions/permissions for this session
        for (const [questionId, question] of state.questions) {
          if (question.sessionId === sessionId) state.questions.delete(questionId)
        }
        for (const [permissionId, permission] of state.permissions) {
          if (permission.sessionId === sessionId) state.permissions.delete(permissionId)
        }

        state.messages.delete(sessionId)
        persistAgentMeta(agent.id, { persistedStatus: 'errored' })
        emit({ agents: true, messages: true, questions: true, permissions: true })
      }
      break
    }

    case 'workspace.failed': {
      // A workspace (sandbox) failed to initialize. Any agent that was being
      // launched into this runtime and is still in 'starting' should show an
      // error so the user doesn't see a perpetually-starting agent.
      const errorMessage = props.message as string | undefined
      for (const agent of state.agents.values()) {
        if (agent.runtimeId === runtimeId && agent.status === 'starting') {
          notifyIfNeeded(agent, 'errored')
          agent.status = 'errored'
          agent.taskSummary = `Workspace failed: ${errorMessage ?? 'unknown error'}`
          agent.lastActivityAt = Date.now()
          persistAgentMeta(agent.id, { persistedStatus: 'errored' })
        }
      }
      emit({ agents: true })
      break
    }

    case 'worktree.failed': {
      // Git worktree creation failed. Same treatment as workspace.failed —
      // agents still in 'starting' on this runtime should show an error.
      const errorMessage = props.message as string | undefined
      for (const agent of state.agents.values()) {
        if (agent.runtimeId === runtimeId && agent.status === 'starting') {
          notifyIfNeeded(agent, 'errored')
          agent.status = 'errored'
          agent.taskSummary = `Worktree failed: ${errorMessage ?? 'unknown error'}`
          agent.lastActivityAt = Date.now()
          persistAgentMeta(agent.id, { persistedStatus: 'errored' })
        }
      }
      emit({ agents: true })
      break
    }

    case 'mcp.browser.open.failed': {
      // MCP OAuth flow couldn't open the browser — surface this to the user
      // so they know why MCP tools are stalling. Log it to the event log of
      // any agent on this runtime.
      const mcpName = props.mcpName as string | undefined
      const url = props.url as string | undefined
      console.warn(`[AgentStore] MCP browser open failed for "${mcpName}": ${url}`)

      // Notify via desktop notification so the user can act on it
      for (const agent of state.agents.values()) {
        if (agent.runtimeId === runtimeId && (agent.status === 'running' || agent.status === 'starting')) {
          agent.lastActivityAt = Date.now()
        }
      }
      emit({ agents: true })
      break
    }

    case 'server.heartbeat': {
      if (!state.healthy) {
        state.healthy = true
        emit({ agents: true })
      }
      break
    }

    default:
      // Ignore unhandled event types
      break
  }
}

/** Number of recent messages to pre-load when a session is resumed. */
const RESUME_MESSAGE_LIMIT = 10

function handleAgentLaunched(payload: AgentLaunchedPayload): void {
  const existingMsgs = state.messages.get(payload.sessionId)
  console.debug(`[handleAgentLaunched] id=${payload.id} session=${payload.sessionId.slice(-8)} existingMsgs=${existingMsgs?.length ?? 'none'} agentExists=${state.agents.has(payload.id)}`)
  upsertAgent(payload)
  // Emit messages alongside agents so any SSE events that arrived before the
  // agent was registered (race between IPC broadcast and SSE delivery) are
  // picked up by the selectedMessages memo in the same render pass.
  emit({ agents: true, messages: true })

  if (window.api) {
    // Fetch historical messages so resumed sessions aren't blank.
    // Fire-and-forget — the initial upsert already emitted.
    void window.api.getMessages(payload.id).then((result) => {
      if (!result.ok || !result.data) return
      const entries = result.data as HistoricalSessionMessage[]
      console.debug(`[handleAgentLaunched:hydrate] id=${payload.id} session=${payload.sessionId.slice(-8)} historicalMsgs=${entries?.length ?? 0} currentStoreMsgs=${state.messages.get(payload.sessionId)?.length ?? 0}`)
      if (!Array.isArray(entries) || entries.length === 0) return
      hydrateHistoricalMessages(entries.slice(-RESUME_MESSAGE_LIMIT))
      console.debug(`[handleAgentLaunched:hydrate] after hydration storeMsgs=${state.messages.get(payload.sessionId)?.length ?? 0} parts=${state.messages.get(payload.sessionId)?.map(m => `${m.role}:${m.parts.length}`).join(',')}`)
      emit({ messages: true })
    })

    // Seed configuredModel from runtime config as an authoritative fallback
    // in case step-depth tracking misses events or the resume window is too small.
    void window.api.getConfig(payload.id).then((result) => {
      if (!result.ok || !result.data) return
      const config = result.data as { model?: string }
      if (!config.model) return
      const agent = state.agents.get(payload.id)
      if (!agent || agent.configuredModel) return
      const formatted = formatModelName(config.model)
      agent.configuredModel = formatted
      if (agent.model === 'starting...') {
        agent.model = formatted
        emit({ agents: true })
      }
    })
  }
}

function handleSessionReset(payload: { id: string; sessionId: string; oldSessionId: string; branchName: string; prompt: string; title: string }): void {
  const agent = state.agents.get(payload.id)
  if (!agent) return

  // Clear old session data
  state.messages.delete(agent.sessionId)
  state.fileChanges.delete(agent.sessionId)
  state.eventLog.delete(agent.sessionId)

  for (const [permissionId, permission] of state.permissions.entries()) {
    if (permission.agentId === payload.id || permission.sessionId === agent.sessionId) {
      state.permissions.delete(permissionId)
    }
  }

  for (const [questionId, question] of state.questions.entries()) {
    if (question.agentId === payload.id || question.sessionId === agent.sessionId) {
      state.questions.delete(questionId)
    }
  }

  // Update agent with new session
  sessionStepDepth.delete(agent.sessionId)
  pendingMessages.delete(payload.id)
  agent.sessionId = payload.sessionId
  agent.branchName = payload.branchName
  agent.prUrl = null
  agent.cost = 0
  agent.tokens = { input: 0, output: 0 }
  agent.contextTokens = undefined
  agent.rawModelId = undefined
  // contextLimit stays cached — the model doesn't change on reset.
  agent.lastActivityAt = Date.now()
  agent.lastError = undefined
  taskSummaryLocked.delete(payload.id)
  prExtractEnabled.delete(payload.id)

  const hasPrompt = payload.prompt && payload.prompt.trim().length > 0
  if (hasPrompt) {
    agent.taskSummary = payload.prompt.slice(0, 120)
    agent.status = 'running'
    injectOptimisticUserMessage(payload.sessionId, payload.prompt)
  } else {
    agent.taskSummary = 'Waiting for prompt...'
    agent.status = 'idle'
  }

  // Session reset touches everything
  emit({ agents: true, messages: true, permissions: true, questions: true })
}

function removeAgentState(agentId: string): void {
  const agent = state.agents.get(agentId)
  if (!agent) return

  taskSummaryLocked.delete(agentId)
  prExtractEnabled.delete(agentId)
  pendingMessages.delete(agentId)
  const compactingTimer = compactingTimers.get(agentId)
  if (compactingTimer) {
    clearTimeout(compactingTimer)
    compactingTimers.delete(agentId)
  }
  sessionStepDepth.delete(agent.sessionId)
  state.agents.delete(agentId)
  state.messages.delete(agent.sessionId)
  state.fileChanges.delete(agent.sessionId)
  state.eventLog.delete(agent.sessionId)

  for (const [permissionId, permission] of state.permissions.entries()) {
    if (permission.agentId === agentId || permission.sessionId === agent.sessionId) {
      state.permissions.delete(permissionId)
    }
  }

  for (const [questionId, question] of state.questions.entries()) {
    if (question.agentId === agentId || question.sessionId === agent.sessionId) {
      state.questions.delete(questionId)
    }
  }
}

function upsertAgent(payload: AgentLaunchedPayload, initialStatus?: AgentStatus): void {
  const hasPrompt = payload.prompt && payload.prompt.trim().length > 0
  const existingAgent = state.agents.get(payload.id)

  // Detect auto-generated titles: the backend produces "projectSlug-N" when no
  // title and no prompt are provided, or echoes the prompt's first 80 chars.
  const projectSlug = payload.directory.split('/').pop() ?? 'project'
  const isAutoTitle = payload.title === payload.prompt?.slice(0, 80)
    || new RegExp(`^${projectSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+$`).test(payload.title)
  const agentName = hasPrompt
    ? deriveNameFromPrompt(payload.prompt)
    : payload.title.slice(0, 30)

  // On reconnection upsertAgent runs again — preserve the user's rename.
  const autoNamed = existingAgent !== undefined
    ? existingAgent.autoNamed
    : isAutoTitle

  const agent: LiveAgent = {
    id: payload.id,
    runtimeId: payload.runtimeId,
    sessionId: payload.sessionId,
    directory: payload.directory,
    name: payload.displayName || existingAgent?.name || (isAutoTitle ? agentName : payload.title.slice(0, 30)),
    projectName: payload.projectName || existingAgent?.projectName || payload.directory.split('/').pop() || payload.directory,
    branchName: existingAgent?.branchName ?? payload.branchName ?? '',
    isWorktree: payload.isWorktree ?? existingAgent?.isWorktree ?? false,
    workspaceName: payload.workspaceName ?? existingAgent?.workspaceName ?? payload.directory.split('/').pop() ?? payload.directory,
    taskSummary: payload.taskSummary || existingAgent?.taskSummary || (hasPrompt ? payload.prompt.slice(0, 120) : 'Waiting for prompt...'),
    status: initialStatus ?? existingAgent?.status ?? (hasPrompt ? 'running' : 'idle'),
    labelIds: existingAgent?.labelIds ?? [],
    model: existingAgent?.model ?? 'starting...',
    configuredModel: existingAgent?.configuredModel,
    prUrl: existingAgent?.prUrl ?? payload.prUrl ?? null,
    lastActivityAt: existingAgent?.lastActivityAt ?? Date.now(),
    cost: existingAgent?.cost ?? 0,
    tokens: existingAgent?.tokens ?? { input: 0, output: 0 },
    autoNamed
  }

  state.agents.set(payload.id, agent)
  if (!state.messages.has(payload.sessionId)) state.messages.set(payload.sessionId, [])
  if (!state.fileChanges.has(payload.sessionId)) state.fileChanges.set(payload.sessionId, [])
  if (!state.eventLog.has(payload.sessionId)) state.eventLog.set(payload.sessionId, [])

  if (hasPrompt && !existingAgent) {
    injectOptimisticUserMessage(payload.sessionId, payload.prompt)
  }
}

function applyStatuses(statuses: AgentStatusesPayload): void {
  for (const statusEntry of Object.values(statuses)) {
    const agent = state.agents.get(statusEntry.agentId)
    if (!agent) continue

    const nextStatus = mapSessionStatus(statusEntry.status.type)
    // Don't let the server override a derived completed status with idle.
    // The server reports idle for finished sessions, but we track completion separately.
    if (nextStatus === 'idle' && agent.status === 'completed') {
      continue
    }
    agent.status = nextStatus
    if (nextStatus === 'needs_input' || nextStatus === 'needs_approval') {

      agent.blockedSince = agent.blockedSince ?? Date.now()
    } else {
      agent.blockedSince = undefined

    }
  }
}

/**
 * Periodic reconciliation: compare local agent statuses against the server's
 * actual session statuses and correct any drift. This catches agents stuck
 * in 'running' due to missed SSE events (reconnection gaps, dropped terminal
 * events, runtime crashes after optimistic updates, etc.).
 *
 * Unlike `applyStatuses` (used at init), this is more conservative:
 * - Only corrects agents whose local status disagrees with the server
 * - Respects completed/completed_manual/stopping as immutable from reconciliation
 * - Logs corrections for debugging
 */
function reconcileStatuses(statuses: AgentStatusesPayload): void {
  let changed = false

  for (const statusEntry of Object.values(statuses)) {
    const agent = state.agents.get(statusEntry.agentId)
    if (!agent) continue

    const serverStatus = mapSessionStatus(statusEntry.status.type)

    // Never override user-driven states
    if (agent.status === 'stopping') continue

    // Don't let the server override completed with idle (same as applyStatuses)
    if (serverStatus === 'idle' && agent.status === 'completed') continue

    // Don't override blocked states when there are pending interrupts
    // (the question reconciliation that follows will correct if needed)
    if (
      (agent.status === 'needs_input' || agent.status === 'needs_approval') &&
      serverStatus === 'running' &&
      agentHasPendingInterrupts(agent.id)
    ) continue

    // If statuses already match, nothing to do
    if (agent.status === serverStatus) continue

    // Don't re-block an agent the user just responded to — the server may
    // still report 'waiting' until it finishes processing the reply.
    if ((serverStatus === 'needs_input' || serverStatus === 'needs_approval') && isWithinOptimisticGuard(agent)) {
      continue
    }

    console.warn(
      `[AgentStore] Reconciliation: agent ${agent.id} status ${agent.status} → ${serverStatus} (server says ${statusEntry.status.type})`
    )
    agent.status = serverStatus
    agent.lastActivityAt = Date.now()
    if (serverStatus === 'needs_input' || serverStatus === 'needs_approval') {

      agent.blockedSince = agent.blockedSince ?? Date.now()
    } else {
      agent.blockedSince = undefined
      agent.respondedAt = undefined

    }
    changed = true
  }

  if (changed) emit({ agents: true })
}

/**
 * Reconcile pending questions from the server with local state.
 * - Adds any questions we missed (SSE gap for question.asked)
 * - Removes stale local questions the server no longer reports (SSE gap for question.replied)
 * - Ensures agents with pending questions are in 'needs_input' status
 */
function reconcileQuestions(
  serverQuestions: Array<{ agentId: string; questions: Array<{ id: string; sessionID: string; questions: LiveQuestionInfo[] }> }>
): void {
  let changed = false

  // Build a set of all server-reported question IDs and which agents were queried
  const serverQuestionIds = new Set<string>()
  const reconciledAgentIds = new Set<string>()
  for (const entry of serverQuestions) {
    reconciledAgentIds.add(entry.agentId)
    for (const q of entry.questions) {
      serverQuestionIds.add(q.id)
    }
  }

  // Add questions the server has that we missed
  for (const entry of serverQuestions) {
    for (const q of entry.questions) {
      if (!state.questions.has(q.id)) {
        console.warn(
          `[AgentStore] Reconciliation: recovered missed question ${q.id} for agent ${entry.agentId}`
        )
        state.questions.set(q.id, {
          id: q.id,
          agentId: entry.agentId,
          sessionId: q.sessionID,
          questions: q.questions,
          createdAt: Date.now()
        })
        changed = true
      }
    }

    // If we have pending questions for this agent, ensure it shows needs_input
    const agent = state.agents.get(entry.agentId)
    if (agent && entry.questions.length > 0 && agent.status !== 'needs_input' && agent.status !== 'stopping') {
      console.warn(
        `[AgentStore] Reconciliation: agent ${agent.id} has pending questions but status is ${agent.status}, correcting to needs_input`
      )

      agent.status = 'needs_input'
      agent.blockedSince = agent.blockedSince ?? Date.now()
      agent.lastActivityAt = Date.now()
      changed = true
    }
  }

  // Remove stale local questions that the server no longer reports.
  // Only prune for agents that appeared in the server response — if an agent
  // is absent entirely it means we didn't query that runtime, not that its
  // questions were answered.
  for (const [localId, localQ] of state.questions) {
    if (reconciledAgentIds.has(localQ.agentId) && !serverQuestionIds.has(localId)) {
      console.warn(
        `[AgentStore] Reconciliation: removing stale question ${localId} for agent ${localQ.agentId}`
      )
      state.questions.delete(localId)
      changed = true
    }
  }

  // For agents whose questions were all cleaned up, clear blocked state
  // so the interrupt guard doesn't permanently lock them in needs_input
  for (const agentId of reconciledAgentIds) {
    const agent = state.agents.get(agentId)
    if (!agent) continue
    if (agent.status === 'needs_input' && !agentHasPendingInterrupts(agentId)) {
      agent.status = 'running'
      agent.blockedSince = undefined
      agent.lastActivityAt = Date.now()

      changed = true
    }
  }

  if (changed) emit({ agents: true, questions: true })
}

/**
 * Reconcile pending permissions from the server with local state.
 * - Adds any permissions we missed (SSE gap for permission.asked)
 * - Removes stale local permissions the server no longer reports (SSE gap for permission.replied)
 * - Ensures agents with pending permissions are in 'needs_approval' status
 */
function reconcilePermissions(
  serverPermissions: Array<{ agentId: string; permissions: Array<PermissionRequestPayload> }>
): void {
  let changed = false

  // Build a set of all server-reported permission IDs and which agents were queried
  const serverPermissionIds = new Set<string>()
  const reconciledAgentIds = new Set<string>()
  for (const entry of serverPermissions) {
    reconciledAgentIds.add(entry.agentId)
    for (const perm of entry.permissions) {
      serverPermissionIds.add(perm.id)
    }
  }

  // Add permissions the server has that we missed
  for (const entry of serverPermissions) {
    for (const perm of entry.permissions) {
      if (!state.permissions.has(perm.id)) {
        console.warn(
          `[AgentStore] Reconciliation: recovered missed permission ${perm.id} for agent ${entry.agentId}`
        )
        const permType = perm.permission ?? 'unknown'
        const title = perm.patterns?.length
          ? `${permType}: ${perm.patterns.join(', ')}`
          : permType

        state.permissions.set(perm.id, {
          id: perm.id,
          agentId: entry.agentId,
          sessionId: perm.sessionID,
          type: permType,
          title,
          pattern: perm.patterns,
          createdAt: Date.now()
        })
        changed = true
      }
    }

    // If we have pending permissions for this agent, ensure it shows needs_approval
    const agent = state.agents.get(entry.agentId)
    if (agent && entry.permissions.length > 0 && agent.status !== 'needs_approval' && agent.status !== 'stopping') {
      console.warn(
        `[AgentStore] Reconciliation: agent ${agent.id} has pending permissions but status is ${agent.status}, correcting to needs_approval`
      )

      agent.status = 'needs_approval'
      agent.blockedSince = agent.blockedSince ?? Date.now()
      agent.lastActivityAt = Date.now()
      changed = true
    }
  }

  // Remove stale local permissions that the server no longer reports.
  // Only prune for agents that appeared in the server response.
  for (const [localId, localPerm] of state.permissions) {
    if (reconciledAgentIds.has(localPerm.agentId) && !serverPermissionIds.has(localId)) {
      console.warn(
        `[AgentStore] Reconciliation: removing stale permission ${localId} for agent ${localPerm.agentId}`
      )
      state.permissions.delete(localId)
      changed = true
    }
  }

  // For agents whose permissions were all cleaned up, clear blocked state
  // so the interrupt guard doesn't permanently lock them in needs_approval
  for (const agentId of reconciledAgentIds) {
    const agent = state.agents.get(agentId)
    if (!agent) continue
    if (agent.status === 'needs_approval' && !agentHasPendingInterrupts(agentId)) {
      agent.status = 'running'
      agent.blockedSince = undefined
      agent.lastActivityAt = Date.now()

      changed = true
    }
  }

  if (changed) emit({ agents: true, permissions: true })
}

// ── Helpers ──

/** How long (ms) after a user response we ignore stale blocked-status events.
 *  This prevents SSE events that were in-flight before the server processed
 *  the reply from flipping the agent back to needs_input / needs_approval. */
const OPTIMISTIC_GUARD_MS = 5_000

function isWithinOptimisticGuard(agent: LiveAgent): boolean {
  return agent.respondedAt !== undefined && Date.now() - agent.respondedAt < OPTIMISTIC_GUARD_MS
}

function findAgentBySession(sessionId: string): LiveAgent | undefined {
  for (const agent of state.agents.values()) {
    if (agent.sessionId === sessionId) return agent
  }
  return undefined
}

function findAgentByRuntime(runtimeId: string): LiveAgent | undefined {
  for (const agent of state.agents.values()) {
    if (agent.runtimeId === runtimeId) return agent
  }
  return undefined
}

/**
 * Pick the most likely target agent for a runtime-scoped event (e.g. a TUI
 * toast) when multiple agents share the runtime. Prefers agents that look
 * actively engaged: compacting, then running, then any. Returns undefined
 * only when the runtime has no agents attached.
 */
function pickToastTargetAgent(runtimeId: string): LiveAgent | undefined {
  let compacting: LiveAgent | undefined
  let busy: LiveAgent | undefined
  let fallback: LiveAgent | undefined
  for (const agent of state.agents.values()) {
    if (agent.runtimeId !== runtimeId) continue
    if (agent.compacting) { compacting = compacting ?? agent; continue }
    if (agent.status === 'running') { busy = busy ?? agent; continue }
    fallback = fallback ?? agent
  }
  return compacting ?? busy ?? fallback
}

/**
 * Check whether an agent has pending questions or permissions in the store.
 * Used to prevent session.status events from clobbering blocked states
 * when the server sends a 'busy' status while questions/permissions are still pending.
 */
function agentHasPendingInterrupts(agentId: string): boolean {
  for (const question of state.questions.values()) {
    if (question.agentId === agentId) return true
  }
  for (const permission of state.permissions.values()) {
    if (permission.agentId === agentId) return true
  }
  return false
}

/**
 * Optimistically mark the agent as running and update its task summary.
 * Shared by sendMessage and dispatchPendingMessage to avoid duplication.
 */
function applyOptimisticSendState(agentId: string, agent: LiveAgent, text: string, taskSummaryOverride?: string): void {
  if (!text.trim()) return

  if (taskSummaryOverride) {
    agent.taskSummary = taskSummaryOverride.slice(0, 120)
    taskSummaryLocked.add(agentId)
    if (taskSummaryOverride === 'Create PR') {
      prExtractEnabled.add(agentId)
    }
  } else {
    agent.taskSummary = text.trim().slice(0, 120)
    taskSummaryLocked.delete(agentId)
  }
  agent.status = 'running'
  agent.lastActivityAt = Date.now()
  agent.blockedSince = undefined
  agent.respondedAt = Date.now()

  injectOptimisticUserMessage(agent.sessionId, text)
  persistAgentMeta(agentId, { taskSummary: agent.taskSummary, persistedStatus: 'running' })
}

/**
 * Dispatch a message that was queued while the agent was stopping.
 * Called when an agent transitions out of 'stopping' (idle/completed).
 */
function dispatchPendingMessage(agentId: string): void {
  const pending = pendingMessages.get(agentId)
  if (!pending) return
  pendingMessages.delete(agentId)

  const agent = state.agents.get(agentId)
  if (!agent || !window.api) return

  const { text, agentConfig, attachments, taskSummaryOverride } = pending

  applyOptimisticSendState(agentId, agent, text, taskSummaryOverride)

  for (const [qId, q] of state.questions) {
    if (q.agentId === agentId) {
      state.questions.delete(qId)
    }
  }

  emit({ agents: true, messages: true, questions: true })

  void window.api.sendMessage(agentId, text, agentConfig, attachments).then((result) => {
    if (result && !result.ok) {
      prExtractEnabled.delete(agentId)
      const agentAfter = state.agents.get(agentId)
      if (agentAfter && agentAfter.status === 'running') {
        agentAfter.status = 'idle'
        agentAfter.blockedSince = undefined
        agentAfter.respondedAt = undefined
        agentAfter.lastActivityAt = Date.now()
      }
      emit({ agents: true })
    }
  })
}

/**
 * Resolve once an agent transitions to a non-busy status (idle, errored,
 * completed) or the timeout elapses. Polls the in-memory store rather than
 * subscribing to events so callers don't have to deal with subscription
 * lifecycles. The store state is updated synchronously by processEvent, so
 * a short poll interval is sufficient.
 */
function waitForAgentSettled(agentId: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now()
    const poll = () => {
      const agent = state.agents.get(agentId)
      if (!agent) return resolve()
      const isSettled = agent.status === 'idle' || agent.status === 'errored' || agent.status === 'completed'
      if (isSettled) return resolve()
      if (Date.now() - start >= timeoutMs) {
        console.warn('[waitForAgentSettled] timed out', { agentId, lastStatus: agent.status })
        return resolve()
      }
      setTimeout(poll, 100)
    }
    poll()
  })
}

/**
 * Re-fetch the session transcript from the server after compaction, since
 * compaction prunes messages server-side and our local cache needs to be
 * replaced with the post-compaction state.
 */
async function refetchSessionMessages(agentId: string): Promise<void> {
  const agent = state.agents.get(agentId)
  if (!agent || !window.api) return

  const result = await window.api.getMessages(agentId)
  if (result.ok && result.data) {
    const entries = result.data as HistoricalSessionMessage[]
    if (Array.isArray(entries) && entries.length > 0) {
      hydrateHistoricalMessages(entries)
      emit({ messages: true })
    }
  }
}

function mapSessionStatus(statusType: string): AgentStatus {
  switch (statusType) {
    case 'busy': return 'running'
    case 'idle': return 'idle'
    case 'retry': return 'running'
    case 'completed': return 'completed'
    case 'error': return 'errored'
    case 'waiting': return 'needs_input'
    default: return 'running'
  }
}

export function formatModelName(modelId: string): string {
  // Claude models: "claude-sonnet-4-20250514" -> "sonnet-4", "claude-opus-4-5-20250630" -> "opus-4.5"
  const claudeMatch = modelId.match(/(sonnet|opus|haiku)-(\d+)(?:-(\d+))?/)
  if (claudeMatch) {
    const [, family, major, minor] = claudeMatch
    // Skip date-like minor segments (6+ digits = date suffix, not a version)
    if (minor && minor.length < 6) {
      return `${family}-${major}.${minor}`
    }
    return `${family}-${major}`
  }

  // GPT models: "gpt-4-turbo", "gpt-4o" -> "gpt-4-turbo", "gpt-4o"
  const gptMatch = modelId.match(/gpt-[\w.-]+/)
  if (gptMatch) return gptMatch[0]

  // OpenAI o-series: "o1-preview", "o1-mini", "o3" -> "o1-preview", etc.
  const oSeriesMatch = modelId.match(/\bo\d[\w-]*/)
  if (oSeriesMatch) return oSeriesMatch[0]

  // Gemini models: "gemini-1.5-pro" -> "gemini-1.5-pro"
  const geminiMatch = modelId.match(/gemini-[\w.-]+/)
  if (geminiMatch) return geminiMatch[0]

  // Truncate long names
  return modelId.length > 16 ? modelId.slice(0, 16) : modelId
}

// ── Tool Call Extraction ──

interface ToolCallInfo {
  partId: string
  toolName: string
  toolState?: string
  text?: string
}

function extractToolCallsFromMessages(messages: LiveMessage[]): ToolCallInfo[] {
  const toolCalls: ToolCallInfo[] = []
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === 'tool' && part.toolName) {
        toolCalls.push({
          partId: part.id,
          toolName: part.toolName,
          toolState: part.toolState,
          text: part.text
        })
      }
    }
  }
  return toolCalls
}

// ── Public Hook ──

export function useAgentStore() {
  const storeState = useSyncExternalStore(subscribe, getSnapshot)

  // Set up event listeners on mount.
  // No ref guard — React StrictMode unmounts+remounts in dev, so the
  // cleanup from the first mount removes the listeners. We must
  // re-register on the second mount.
  useEffect(() => {
    if (!window.api) return

    let cancelled = false

    const initializeAgents = async (): Promise<void> => {
      const [agentsResult, statusesResult] = await Promise.all([
        window.api.listAgents(),
        window.api.getStatuses()
      ])

      if (cancelled) return

      let shouldEmit = false

      if (agentsResult.ok && agentsResult.data) {
        // Legacy: old versions stored label values in persistedStatus.
        // Map them to labelIds for backward compatibility during migration.
        const LEGACY_PERSISTED_TO_LABEL: Record<string, string> = {
          in_review: 'in_review', blocked: 'blocked', done: 'done', draft: 'draft',
          completed_manual: 'done', blocked_manual: 'blocked'
        }
        // Don't trust 'running' across restarts — the session was interrupted,
        // so default to idle until the server confirms otherwise.
        const PERSISTED_TO_STATUS: Record<string, AgentStatus> = {
          idle: 'idle',
          running: 'idle',
          completed: 'completed',
          errored: 'errored'
        }

        for (const agent of agentsResult.data) {
          const restoredStatus: AgentStatus = (agent.persistedStatus && PERSISTED_TO_STATUS[agent.persistedStatus]) || 'idle'
          upsertAgent(agent, restoredStatus)
          const liveAgent = state.agents.get(agent.id)
          if (liveAgent) {
            // Prefer labelIds; fall back to legacy labelId; fall back to legacy persistedStatus mapping
            if (agent.labelIds) {
              liveAgent.labelIds = agent.labelIds
            } else if (agent.labelId) {
              liveAgent.labelIds = [agent.labelId]
            } else {
              const legacyLabel = agent.persistedStatus && LEGACY_PERSISTED_TO_LABEL[agent.persistedStatus]
              liveAgent.labelIds = legacyLabel ? [legacyLabel] : []
            }
          }
          shouldEmit = true
        }

        const messageResults = await Promise.all(
          agentsResult.data.map(async (agent) => ({
            result: await window.api.getMessages(agent.id)
          }))
        )

        if (cancelled) return

        for (const { result } of messageResults) {
          if (!result.ok) continue
          hydrateHistoricalMessages(result.data)
          shouldEmit = true
        }
      }

      if (statusesResult.ok && statusesResult.data) {
        applyStatuses(statusesResult.data)
        shouldEmit = true
      }

      if (shouldEmit) emit({ agents: true, messages: true })

      // Fetch pending questions for agents that are in needs_input state
      try {
        const questionsResult = await window.api.listQuestions()
        if (!cancelled && questionsResult.ok && questionsResult.data) {
          for (const entry of questionsResult.data as Array<{ agentId: string; questions: Array<{ id: string; sessionID: string; questions: LiveQuestionInfo[] }> }>) {
            for (const q of entry.questions) {
              state.questions.set(q.id, {
                id: q.id,
                agentId: entry.agentId,
                sessionId: q.sessionID,
                questions: q.questions,
                createdAt: Date.now()
              })
            }
          }
          emit({ questions: true })
        }
      } catch {
        // Questions API may not be available on older servers
      }

      // Fetch pending permissions for agents that are in needs_approval state
      try {
        const permissionsResult = await window.api.listPermissions()
        if (!cancelled && permissionsResult.ok && permissionsResult.data) {
          for (const entry of permissionsResult.data as Array<{ agentId: string; permissions: Array<PermissionRequestPayload> }>) {
            for (const perm of entry.permissions) {
              const permType = perm.permission ?? 'unknown'
              const title = perm.patterns?.length
                ? `${permType}: ${perm.patterns.join(', ')}`
                : permType

              state.permissions.set(perm.id, {
                id: perm.id,
                agentId: entry.agentId,
                sessionId: perm.sessionID,
                type: permType,
                title,
                pattern: perm.patterns,
                createdAt: Date.now()
              })
            }
          }
          emit({ permissions: true })
        }
      } catch {
        // Permissions API may not be available on older servers
      }

    }

    const cleanups = [
      window.api.onEvent(processEvent),
      window.api.onAgentLaunched(handleAgentLaunched),
      window.api.onSessionReset(handleSessionReset),
      window.api.onEventError((data) => {
        console.error(`[EventError] Runtime ${data.runtimeId}: ${data.error}`)
        state.healthy = false
        emit({ agents: true })
      }),
      window.api.onAgentsRestored(async () => {
        await initializeAgents()
        if (!cancelled && state.initializing) {
          state.initializing = false
          emit({ agents: true })
        }
      }),
      // Backfill contextLimit for agents whose modelID was hydrated before the
      // provider fetch completed (common on cold start).
      subscribeToContextLimits(backfillContextLimits)
    ]

    // Kick off the provider fetch so context-window limits are populated for
    // agents that will hydrate shortly. useModelOptions would do this too, but
    // only when a consumer mounts — the fleet table's Context column needs
    // the data even if the user never opens the Launch or Settings modal.
    void ensureProvidersLoaded()

    // Run initial fetch. If restoration already completed before we
    // mounted (fast startup or no persisted agents), clear initializing
    // immediately. Otherwise the onAgentsRestored listener handles it.
    const boot = async (): Promise<void> => {
      await initializeAgents()
      if (cancelled) return
      const restored = await window.api.isAgentsRestored()
      if (!cancelled && restored.ok && restored.data && state.initializing) {
        state.initializing = false
        emit({ agents: true })
      }
    }
    void boot()

    // Periodic status reconciliation: re-poll the server every 30s to correct
    // any status drift caused by missed SSE events (reconnection gaps, dropped
    // terminal events, etc.). Without this, agents can appear stuck in 'running'
    // indefinitely when the SSE stream misses a session.idle/completed/error event.
    const RECONCILE_INTERVAL_MS = 30_000
    const reconcileInterval = setInterval(async () => {
      if (cancelled || !window.api) return
      try {
        const statusesResult = await window.api.getStatuses()
        if (cancelled) return
        if (statusesResult.ok && statusesResult.data) {
          reconcileStatuses(statusesResult.data)
        }

        // Also re-fetch pending questions. If a question.asked SSE event was
        // missed (reconnection gap, event ordering race), the agent would be
        // stuck in 'running' with no question card. Polling recovers from this.
        const questionsResult = await window.api.listQuestions()
        if (cancelled) return
        if (questionsResult.ok && questionsResult.data) {
          reconcileQuestions(questionsResult.data as Array<{ agentId: string; questions: Array<{ id: string; sessionID: string; questions: LiveQuestionInfo[] }> }>)
        }

        // Same for permissions — if a permission.asked SSE event was missed,
        // the agent would be stuck with no permission card in the UI.
        const permissionsResult = await window.api.listPermissions()
        if (cancelled) return
        if (permissionsResult.ok && permissionsResult.data) {
          reconcilePermissions(permissionsResult.data as Array<{ agentId: string; permissions: Array<PermissionRequestPayload> }>)
        }
      } catch {
        // Silently ignore — next interval will retry
      }
    }, RECONCILE_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(reconcileInterval)
      for (const cleanup of cleanups) cleanup()
    }
  }, [])

  // Stabilize array references: only create new arrays when the underlying Map
  // contents actually change. Without this, every SSE event creates new arrays →
  // all downstream useMemo deps invalidate → the entire App tree re-renders,
  // causing typing lag in DetailDrawer.
  //
  // Deps intentionally use module-level version counters instead of storeState.
  // This works because emit() always creates a new state reference which triggers
  // useSyncExternalStore to re-render, at which point the updated counter value
  // is visible to useMemo's comparison. The callback closures capture the current
  // storeState from the render, so the data is always fresh when the memo executes.
  const agents = useMemo(
    () => Array.from(storeState.agents.values()),
    [agentsVersion]
  )
  const permissions = useMemo(
    () => Array.from(storeState.permissions.values()),
    [permissionsVersion]
  )
  const questions = useMemo(
    () => Array.from(storeState.questions.values()),
    [questionsVersion]
  )

  const launchAgent = useCallback(async (directory: string, prompt?: string, title?: string, model?: string, attachments?: MessageAttachment[]) => {
    if (!window.api) return
    const result = await window.api.launchAgent({ directory, prompt, title, model, attachments })
    if (!result.ok) {
      console.error('Failed to launch agent:', result.error)
    } else if (result.data) {
      // Ensure the agent appears in the store immediately, even if the
      // IPC broadcast from main arrived before the listener was registered.
      const data = result.data as AgentLaunchedPayload
      const projectSlug = directory.split('/').pop() ?? 'project'
      if (!state.agents.has(data.id)) {
        handleAgentLaunched({
          id: data.id,
          runtimeId: data.runtimeId,
          sessionId: data.sessionId,
          directory: data.directory ?? directory,
          projectName: data.projectName ?? (directory.split('/').pop() ?? directory),
          branchName: data.branchName ?? '',
          isWorktree: data.isWorktree ?? false,
          workspaceName: data.workspaceName ?? (directory.split('/').pop() ?? directory),
          prompt: data.prompt ?? prompt ?? '',
          title: data.title ?? title ?? (prompt ? prompt.slice(0, 80) : projectSlug)
        })
      }
    }
    return result
  }, [])

  const sendMessage = useCallback(async (agentId: string, text: string, agentConfig?: string, attachments?: MessageAttachment[], taskSummaryOverride?: string) => {
    if (!window.api) return

    // Queue the message if the agent is still stopping — it will be dispatched
    // automatically once the abort completes.
    const agent = state.agents.get(agentId)
    if (agent?.status === 'stopping') {
      pendingMessages.set(agentId, { text, agentConfig, attachments, taskSummaryOverride })
      return { ok: true, queued: true }
    }

    // Sending a new message supersedes any stale error banner.
    if (agent?.lastError) {
      agent.lastError = undefined
    }

    const previousStatus = agent?.status
    const previousBlockedSince = agent?.blockedSince
    const previousLabelIds = agent?.labelIds ? [...agent.labelIds] : []

    if (agent) {
      applyOptimisticSendState(agentId, agent, text, taskSummaryOverride)
    }

    // Optimistically clear any pending questions for this agent
    // (sending a message is the response to a needs_input state)
    const removedQuestions: Array<[string, LiveQuestion]> = []
    for (const [qId, q] of state.questions) {
      if (q.agentId === agentId) {
        removedQuestions.push([qId, q])
        state.questions.delete(qId)
      }
    }

    emit({ agents: true, messages: true, questions: true })

    const result = await window.api.sendMessage(agentId, text, agentConfig, attachments)

    // Rollback optimistic state if the send failed
    if (result && !result.ok) {
      console.error('[sendMessage] send failed, rolling back optimistic state', { agentId, error: result.error })
      prExtractEnabled.delete(agentId)
      const agentAfter = state.agents.get(agentId)
      if (agentAfter && agentAfter.status === 'running') {
        agentAfter.status = previousStatus ?? 'idle'
        agentAfter.blockedSince = previousBlockedSince
        agentAfter.respondedAt = undefined
        agentAfter.lastActivityAt = Date.now()
        agentAfter.labelIds = previousLabelIds
      }
      for (const [qId, q] of removedQuestions) {
        state.questions.set(qId, q)
      }
      emit({ agents: true, questions: true })
    }

    return result
  }, [])

  const listCommands = useCallback(async (agentId: string) => {
    if (!window.api) return null
    const result = await window.api.listCommands(agentId)
    if (!result.ok) {
      console.error('Failed to list commands:', result.error)
      return null
    }
    return result.data as Array<{ name: string; description?: string; template: string }> | null
  }, [])

  const listAgentConfigs = useCallback(async (agentId: string) => {
    if (!window.api) return null
    const result = await window.api.listAgentConfigs(agentId)
    if (!result.ok) {
      console.error('Failed to list agent configs:', result.error)
      return null
    }
    return result.data as Array<{ name: string; description?: string }> | null
  }, [])

  const executeCommand = useCallback(async (agentId: string, command: string, args: string) => {
    if (!window.api) return

    const agent = state.agents.get(agentId)
    if (agent?.status === 'stopping') return

    // Show the slash command in the task summary so it's visible in the dashboard
    const previousStatus = agent?.status
    const previousSummary = agent?.taskSummary
    if (agent) {
      const cmdText = args ? `/${command} ${args}` : `/${command}`
      agent.taskSummary = cmdText.slice(0, 120)
      agent.status = 'running'
      agent.lastActivityAt = Date.now()
      agent.blockedSince = undefined
      taskSummaryLocked.add(agentId)
      persistAgentMeta(agentId, { taskSummary: agent.taskSummary, persistedStatus: 'running' })
      emit({ agents: true })
    }

    const result = await window.api.executeCommand(agentId, command, args)

    if (result && !result.ok) {
      const agentAfter = state.agents.get(agentId)
      if (agentAfter) {
        agentAfter.status = previousStatus ?? 'idle'
        agentAfter.taskSummary = previousSummary ?? agentAfter.taskSummary
        agentAfter.lastActivityAt = Date.now()
        taskSummaryLocked.delete(agentId)
        emit({ agents: true })
      }
    }

    return result
  }, [])

  const prepareFreshAgent = useCallback((agentId: string, prompt?: string) => {
    const agent = state.agents.get(agentId)
    if (!agent) return

    const trimmedPrompt = prompt?.trim() ?? ''

    if (trimmedPrompt) {
      agent.taskSummary = trimmedPrompt.slice(0, 120)
      agent.name = deriveNameFromPrompt(trimmedPrompt)
      agent.autoNamed = false
      agent.status = 'running'
    } else {
      agent.taskSummary = 'Fresh session - waiting for prompt...'
      agent.name = deriveFreshAgentName(agent.projectName)
      agent.autoNamed = true
      agent.status = 'idle'
    }

    agent.lastActivityAt = Date.now()
    agent.blockedSince = undefined
    persistAgentMeta(agentId, { displayName: agent.name, taskSummary: agent.taskSummary })
    emit({ agents: true })
  }, [])

  const respondToPermission = useCallback(async (agentId: string, permissionId: string, response: 'once' | 'always' | 'reject') => {
    if (!window.api) return

    const agent = state.agents.get(agentId)
    const previousStatus = agent?.status
    const previousBlockedSince = agent?.blockedSince
    const previousLabelIds = agent?.labelIds ? [...agent.labelIds] : []
    const removedPermission = state.permissions.get(permissionId)

    // Optimistically clear permission and set running
    state.permissions.delete(permissionId)
    if (agent) {
      if (agent.status !== 'stopping') {
        agent.status = 'running'
        agent.blockedSince = undefined
      }
      agent.lastActivityAt = Date.now()
      agent.respondedAt = Date.now()

    }
    emit({ agents: true, permissions: true })

    const result = await window.api.respondToPermission(agentId, permissionId, response)

    if (result && !result.ok) {
      const agentAfter = state.agents.get(agentId)
      if (agentAfter && agentAfter.status === 'running') {
        agentAfter.status = previousStatus ?? 'idle'
        agentAfter.blockedSince = previousBlockedSince
        agentAfter.respondedAt = undefined
        agentAfter.lastActivityAt = Date.now()
        agentAfter.labelIds = previousLabelIds
      }
      if (removedPermission) {
        state.permissions.set(permissionId, removedPermission)
      }
      emit({ agents: true, permissions: true })
    }

    return result
  }, [])

  const replyToQuestion = useCallback(async (agentId: string, requestId: string, answers: string[][]) => {
    if (!window.api) return

    const agent = state.agents.get(agentId)
    const previousStatus = agent?.status
    const previousBlockedSince = agent?.blockedSince
    const previousLabelIds = agent?.labelIds ? [...agent.labelIds] : []
    const removedQuestion = state.questions.get(requestId)

    // Optimistically clear question and set running
    state.questions.delete(requestId)
    if (agent) {
      agent.status = 'running'
      agent.blockedSince = undefined
      agent.lastActivityAt = Date.now()
      agent.respondedAt = Date.now()

    }
    emit({ agents: true, questions: true })

    const result = await window.api.replyToQuestion(agentId, requestId, answers)

    if (result && !result.ok) {
      const agentAfter = state.agents.get(agentId)
      if (agentAfter && agentAfter.status === 'running') {
        agentAfter.status = previousStatus ?? 'idle'
        agentAfter.blockedSince = previousBlockedSince
        agentAfter.respondedAt = undefined
        agentAfter.lastActivityAt = Date.now()
        agentAfter.labelIds = previousLabelIds
      }
      if (removedQuestion) {
        state.questions.set(requestId, removedQuestion)
      }
      emit({ agents: true, questions: true })
    }

    return result
  }, [])

  const rejectQuestion = useCallback(async (agentId: string, requestId: string) => {
    if (!window.api) return

    const agent = state.agents.get(agentId)
    const previousStatus = agent?.status
    const previousBlockedSince = agent?.blockedSince
    const previousLabelIds = agent?.labelIds ? [...agent.labelIds] : []
    const removedQuestion = state.questions.get(requestId)

    // Optimistically clear question and set running
    state.questions.delete(requestId)
    if (agent) {
      agent.status = 'running'
      agent.blockedSince = undefined
      agent.lastActivityAt = Date.now()
      agent.respondedAt = Date.now()

    }
    emit({ agents: true, questions: true })

    const result = await window.api.rejectQuestion(agentId, requestId)

    if (result && !result.ok) {
      const agentAfter = state.agents.get(agentId)
      if (agentAfter && agentAfter.status === 'running') {
        agentAfter.status = previousStatus ?? 'idle'
        agentAfter.blockedSince = previousBlockedSince
        agentAfter.respondedAt = undefined
        agentAfter.lastActivityAt = Date.now()
        agentAfter.labelIds = previousLabelIds
      }
      if (removedQuestion) {
        state.questions.set(requestId, removedQuestion)
      }
      emit({ agents: true, questions: true })
    }

    return result
  }, [])

  const abortAgent = useCallback(async (agentId: string) => {
    if (!window.api) return

    // Optimistically set 'stopping' so the UI reflects intent immediately
    const agent = state.agents.get(agentId)
    if (agent) {
      agent.status = 'stopping'
      agent.lastActivityAt = Date.now()
      emit({ agents: true })
    }

    const result = await window.api.abortAgent(agentId)

    // If abort failed, the server never got the request — fall back to idle
    // so the user isn't stuck in a phantom 'stopping'/'running' state
    if (!result.ok) {
      const agentAfter = state.agents.get(agentId)
      if (agentAfter && agentAfter.status === 'stopping') {
        agentAfter.status = 'idle'
        agentAfter.lastActivityAt = Date.now()
        emit({ agents: true })
        dispatchPendingMessage(agentId)
      }
    } else {
      // Safety timeout: if the server acknowledged the abort but the SSE event
      // (session.idle/completed) never arrives (broken stream, runtime crash),
      // force-transition to idle so the user isn't stuck forever.
      setTimeout(() => {
        const agentAfter = state.agents.get(agentId)
        if (agentAfter && agentAfter.status === 'stopping') {
          console.warn(`[AgentStore] Agent ${agentId} stuck in 'stopping' for 10s, forcing idle`)
          agentAfter.status = 'idle'
          agentAfter.lastActivityAt = Date.now()
          emit({ agents: true })
          dispatchPendingMessage(agentId)
        }
      }, 10_000)
    }

    return result
  }, [])

  const resetSession = useCallback(async (agentId: string, prompt?: string) => {
    if (!window.api) return
    return window.api.resetSession(agentId, prompt)
  }, [])

  const removeAgent = useCallback((agentId: string) => {
    if (!window.api) return

    removeAgentState(agentId)
    emit({ agents: true, messages: true, permissions: true, questions: true })

    // Background cleanup (runtime stop, worktree removal) in main process
    window.api.removeAgent(agentId).then((result) => {
      if (!result.ok) {
        console.error('Failed to remove agent (background cleanup):', result.error)
      }
    })

    return { ok: true }
  }, [])

  const selectDirectory = useCallback(async () => {
    if (!window.api) return null
    const result = await window.api.selectDirectory()
    if (result.ok) return result.data ?? null
    return null
  }, [])

  const getMessagesForSession = useCallback((sessionId: string): LiveMessage[] => {
    return storeState.messages.get(sessionId) ?? []
  }, [messagesVersion])

  const getFileChangesForSession = useCallback((sessionId: string): FileChangeRecord[] => {
    return storeState.fileChanges.get(sessionId) ?? []
  }, [fileChangesVersion])

  const getEventsForSession = useCallback((sessionId: string): EventLogEntry[] => {
    return storeState.eventLog.get(sessionId) ?? []
  }, [eventLogVersion])

  const getToolCallsForSession = useCallback((sessionId: string): ToolCallInfo[] => {
    const messages = storeState.messages.get(sessionId) ?? []
    return extractToolCallsFromMessages(messages)
  }, [messagesVersion])

  const setAgentModel = useCallback((agentId: string, modelPath: string, variant?: string) => {
    const agent = state.agents.get(agentId)
    if (!agent) return
    const formatted = formatModelName(modelPath)
    agent.model = formatted
    agent.configuredModel = formatted
    agent.variant = variant
    emit({ agents: true })
  }, [])

  const renameAgent = useCallback((agentId: string, newName: string) => {
    const agent = state.agents.get(agentId)
    if (!agent) return
    agent.name = newName
    agent.autoNamed = false
    persistAgentMeta(agentId, { displayName: newName })
    emit({ agents: true })
  }, [])

  const toggleLabel = useCallback((agentId: string, labelId: string) => {
    const agent = state.agents.get(agentId)
    if (!agent) return
    const has = agent.labelIds.includes(labelId)
    agent.labelIds = has
      ? agent.labelIds.filter((id) => id !== labelId)
      : [...agent.labelIds, labelId]
    agent.lastActivityAt = Date.now()
    persistAgentMeta(agentId, { labelIds: agent.labelIds })
    emit({ agents: true })
  }, [])

  const clearLabels = useCallback((agentId: string) => {
    const agent = state.agents.get(agentId)
    if (!agent) return
    agent.labelIds = []
    agent.lastActivityAt = Date.now()
    persistAgentMeta(agentId, { labelIds: [] })
    emit({ agents: true })
  }, [])

  const replaceLabel = useCallback((agentId: string, oldLabelId: string, newLabelId: string) => {
    const agent = state.agents.get(agentId)
    if (!agent) return
    agent.labelIds = agent.labelIds.map((id) => id === oldLabelId ? newLabelId : id)
    agent.lastActivityAt = Date.now()
    persistAgentMeta(agentId, { labelIds: agent.labelIds })
    emit({ agents: true })
  }, [])

  /**
   * Dismiss the current error banner without any corrective action. The user
   * decides when (and whether) to compact, switch models, or retry.
   */
  const dismissAgentError = useCallback((agentId: string) => {
    const agent = state.agents.get(agentId)
    if (!agent?.lastError) return
    agent.lastError = undefined
    emit({ agents: true })
  }, [])

  /**
   * Trigger server-side compaction on the user's behalf. Aborts any running
   * turn first — compactSession 400s on a busy session. Shows a spinner while
   * the RPC and the provider-side summarization run; cleared when the server
   * emits session.compacted (success), the RPC fails, or the watchdog fires.
   */
  const compactSession = useCallback(async (agentId: string): Promise<IpcResult | undefined> => {
    if (!window.api) return
    const agent = state.agents.get(agentId)
    if (!agent) {
      console.error('[compactSession] agent not found', agentId)
      return
    }

    console.log('[compactSession] requested', { agentId, sessionId: agent.sessionId, status: agent.status })

    const isBusy = agent.status === 'running' || agent.status === 'needs_approval' || agent.status === 'needs_input' || agent.status === 'stopping'
    if (isBusy) {
      console.log('[compactSession] aborting busy session first', { agentId, status: agent.status })
      const abortResult = await window.api.abortAgent(agentId)
      if (!abortResult.ok) {
        console.error('[compactSession] abort failed', { agentId, error: abortResult.error })
        return abortResult
      }
      await waitForAgentSettled(agentId, 10_000)
    }

    setCompacting(agentId, true)
    agent.lastActivityAt = Date.now()

    const result = await window.api.compactSession(agentId)
    if (result?.ok) {
      console.log('[compactSession] RPC accepted, waiting for server activity', { agentId })
    } else {
      console.error('[compactSession] RPC failed', { agentId, error: result?.error })
      setCompacting(agentId, false)
      const agentAfter = state.agents.get(agentId)
      if (agentAfter) {
        // Surface the real error in the banner so the user sees why compaction
        // failed (e.g. provider auth, rate limit, session too large).
        agentAfter.lastError = {
          name: 'CompactionFailed',
          message: result?.error ?? 'Compaction request was rejected by the server.',
          sessionId: agentAfter.sessionId,
          occurredAt: Date.now()
        }
        agentAfter.lastActivityAt = Date.now()
        emit({ agents: true })
      }
    }
    return result
  }, [])

  const setPrUrl = useCallback((agentId: string, prUrl: string | null) => {
    const agent = state.agents.get(agentId)
    if (!agent) return
    agent.prUrl = prUrl
    persistAgentMeta(agentId, { prUrl: prUrl ?? '' })
    emit({ agents: true })
  }, [])

  return useMemo(() => ({
    agents,
    permissions,
    questions,
    healthy: storeState.healthy,
    initializing: storeState.initializing,
    launchAgent,
    sendMessage,
    listCommands,
    listAgentConfigs,
    executeCommand,
    prepareFreshAgent,
    resetSession,
    respondToPermission,
    replyToQuestion,
    rejectQuestion,
    abortAgent,
    removeAgent,
    renameAgent,
    setAgentModel,
    toggleLabel,
    clearLabels,
    replaceLabel,
    setPrUrl,
    dismissAgentError,
    compactSession,
    selectDirectory,
    getMessagesForSession,
    getFileChangesForSession,
    getEventsForSession,
    getToolCallsForSession
  }), [
    agents, permissions, questions, storeState.healthy, storeState.initializing,
    launchAgent, sendMessage, listCommands, listAgentConfigs,
    executeCommand, prepareFreshAgent, resetSession,
    respondToPermission, replyToQuestion, rejectQuestion,
    abortAgent, removeAgent, renameAgent, setAgentModel,
    toggleLabel, clearLabels, setPrUrl,
    dismissAgentError, compactSession, selectDirectory,
    getMessagesForSession, getFileChangesForSession,
    getEventsForSession, getToolCallsForSession
  ])
}
