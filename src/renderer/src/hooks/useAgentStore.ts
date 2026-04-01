import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { AgentStatus } from '../types'
import type {
  OpenCodeEventPayload,
  AgentLaunchedPayload,
  AgentStatusesPayload
} from '../types/api'

interface HistoricalMessageInfo {
  id: string
  sessionID: string
  role: 'user' | 'assistant'
  time?: {
    created?: number
  }
  modelID?: string
  cost?: number
  tokens?: {
    input: number
    output: number
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
  model: string
  lastActivityAt: number
  blockedSince?: number
  cost: number
  tokens: { input: number; output: number }
  /** Whether the name was auto-generated and should be replaced by the first prompt */
  autoNamed?: boolean
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

export interface LiveMessage {
  id: string
  role: 'user' | 'assistant'
  sessionId: string
  createdAt: number
  parts: LiveMessagePart[]
}

export interface LiveMessagePart {
  id: string
  type: 'text' | 'tool' | 'reasoning' | 'step-start' | 'step-finish' | string
  text?: string
  toolName?: string
  toolState?: string
  toolInput?: string
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
  messages: Map<string, LiveMessage[]> // keyed by sessionId
  fileChanges: Map<string, FileChangeRecord[]> // keyed by sessionId
  eventLog: Map<string, EventLogEntry[]> // keyed by sessionId
  healthy: boolean
  messageVersion: number // bumped only when message data changes
}

let state: AgentStoreState = {
  agents: new Map(),
  permissions: new Map(),
  messages: new Map(),
  fileChanges: new Map(),
  eventLog: new Map(),
  healthy: true,
  messageVersion: 0
}

let eventCounter = 0

const listeners = new Set<() => void>()

function emit(): void {
  // Create new state reference to trigger re-renders
  state = { ...state }
  for (const listener of listeners) {
    listener()
  }
}

function emitMessageChange(): void {
  state.messageVersion++
  emit()
}

function persistAgentMeta(agentId: string, meta: { displayName?: string; taskSummary?: string }): void {
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
    case 'permission.updated':
      return `Permission requested: ${props.title ?? props.type ?? 'unknown'}`
    case 'permission.replied':
      return 'Permission resolved'
    case 'file.edited':
      return `File edited: ${props.file ?? props.path ?? 'unknown'}`
    case 'file.created':
      return `File created: ${props.file ?? props.path ?? 'unknown'}`
    case 'file.deleted':
      return `File deleted: ${props.file ?? props.path ?? 'unknown'}`
    case 'server.heartbeat':
      return 'Server heartbeat'
    default:
      return `Event: ${type}`
  }
}

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
  state.eventLog.set(sessionId, entries)
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
    text: part.text ?? part.reason ?? part.snapshot
  }

  if (part.type === 'tool') {
    nextPart.toolName = part.tool
    nextPart.toolState = part.state?.status
    nextPart.toolInput = stringifyToolInput(part.state?.input)
    nextPart.text = part.text ?? part.state?.output ?? part.state?.error ?? part.state?.title ?? part.state?.raw
  }

  return nextPart
}

function hydrateHistoricalMessages(entries: unknown): void {
  if (!Array.isArray(entries)) return

  for (const entry of entries as HistoricalSessionMessage[]) {
    if (!entry?.info?.id || !entry.info.sessionID || !Array.isArray(entry.parts)) continue

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
      }

      if (entry.info.modelID) {
        agent.model = formatModelName(entry.info.modelID)
      }
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

function notifyIfNeeded(agent: LiveAgent, newStatus: string): void {
  if (agent.status === newStatus) return
  if (!NOTIFIABLE_STATUSES.has(newStatus)) return

  // Don't notify for the agent whose transcript is currently open
  if (agent.id === viewedAgentId) return

  // Treat running→idle as "completed" for notification purposes
  const notifyStatus = (newStatus === 'idle' && agent.status === 'running') ? 'completed' : newStatus
  if (notifyStatus === 'idle') return // only notify idle when coming from running

  window.api?.notifyAgentStatus(agent.id, notifyStatus, agent.name, agent.projectName)
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
        if (agent.status !== newStatus) {
          notifyIfNeeded(agent, newStatus)
          agent.status = newStatus
          agent.lastActivityAt = Date.now()
          if (newStatus === 'needs_input' || newStatus === 'needs_approval') {
            agent.blockedSince = agent.blockedSince ?? Date.now()
          } else {
            agent.blockedSince = undefined
          }
          emit()
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
        emit()
      }
      break
    }

    case 'session.error': {
      const sessionId = props.sessionID as string
      const agent = findAgentBySession(sessionId)
      if (agent) {
        notifyIfNeeded(agent, 'errored')
        agent.status = 'errored'
        agent.lastActivityAt = Date.now()
        emit()
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
        emit()
      }
      break
    }

    case 'session.updated': {
      const info = props.info as Record<string, unknown> | undefined
      const sessionId = info?.id as string | undefined
      if (!sessionId) break
      const agent = findAgentBySession(sessionId)
      if (agent) {
        const time = info?.time as { updated?: number } | undefined
        agent.lastActivityAt = typeof time?.updated === 'number' ? time.updated : Date.now()
        const title = info?.title as string | undefined
        if (title && !title.match(/^agent-\d+(-\d+)?$/)) {
          agent.taskSummary = title.slice(0, 120)
          persistAgentMeta(agent.id, { taskSummary: agent.taskSummary })
        }
        emit()
      }
      break
    }

    case 'message.updated': {
      const info = props.info as Record<string, unknown>
      const sessionId = info.sessionID as string
      const messageId = info.id as string
      const role = info.role as 'user' | 'assistant'
      const createdAt = getMessageCreatedAt(info)

      const agent = findAgentBySession(sessionId)
      if (agent) {
        agent.lastActivityAt = Date.now()

        // Update cost/tokens from assistant messages
        if (role === 'assistant') {
          const cost = info.cost as number | undefined
          const tokens = info.tokens as { input: number; output: number } | undefined
          if (cost !== undefined) agent.cost = cost
          if (tokens) agent.tokens = { input: tokens.input, output: tokens.output }

          // Extract model info
          const modelId = info.modelID as string | undefined
          if (modelId) {
            agent.model = formatModelName(modelId)
          }
        }
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

      emitMessageChange()
      break
    }

    case 'message.part.updated': {
      const part = props.part as Record<string, unknown>
      const sessionId = part.sessionID as string
      const messageId = part.messageID as string
      const partId = part.id as string
      const partType = part.type as string

      const messages = state.messages.get(sessionId) ?? []
      const message = messages.find((msg) => msg.id === messageId)

      if (message) {
        const existingPart = message.parts.find((partItem) => partItem.id === partId)
        const toolState = part.state as Record<string, unknown> | undefined
        if (existingPart) {
          existingPart.text = getToolOutput(part, toolState) ?? part.text as string | undefined
          if (partType === 'tool') {
            existingPart.toolState = getToolState(toolState)
            existingPart.toolInput = stringifyToolInput(toolState?.input)
          }
        } else {
          const newPart: LiveMessagePart = {
            id: partId,
            type: partType,
            text: getToolOutput(part, toolState) ?? part.text as string | undefined
          }
          if (partType === 'tool') {
            newPart.toolName = part.tool as string | undefined
            newPart.toolState = getToolState(toolState)
            newPart.toolInput = stringifyToolInput(toolState?.input)
          }
          message.parts.push(newPart)
        }

        // Update agent activity (but don't clobber blocked states like needs_input/needs_approval)
        const agent = findAgentBySession(sessionId)
        if (agent) {
          agent.lastActivityAt = Date.now()
          if (agent.status !== 'needs_input' && agent.status !== 'needs_approval') {
            agent.status = 'running'
            agent.blockedSince = undefined
          }

          // Update task summary from first user text part
          if (message.role === 'user' && partType === 'text' && part.text) {
            const text = part.text as string
            if (text.length > 0) {
              agent.taskSummary = text.slice(0, 120)

              // Auto-name the agent from the first prompt if no explicit name was given
              if (agent.autoNamed) {
                agent.name = deriveNameFromPrompt(text)
                agent.autoNamed = false
              }

              persistAgentMeta(agent.id, { displayName: agent.name, taskSummary: agent.taskSummary })
            }
          }
        }

        emitMessageChange()
      }
      break
    }

    case 'permission.updated': {
      const permissionId = props.id as string
      const sessionId = props.sessionID as string
      const permType = props.type as string
      const title = props.title as string
      const pattern = props.pattern as string | string[] | undefined

      const agent = findAgentBySession(sessionId)
      if (agent) {
        notifyIfNeeded(agent, 'needs_approval')
        agent.status = 'needs_approval'
        agent.blockedSince = agent.blockedSince ?? Date.now()
        agent.lastActivityAt = Date.now()

        state.permissions.set(permissionId, {
          id: permissionId,
          agentId: agent.id,
          sessionId,
          type: permType,
          title,
          pattern,
          createdAt: Date.now()
        })

        emit()
      }
      break
    }

    case 'permission.replied': {
      const permissionId = props.permissionID as string
      state.permissions.delete(permissionId)

      const sessionId = props.sessionID as string
      const agent = findAgentBySession(sessionId)
      if (agent) {
        agent.status = 'running'
        agent.blockedSince = undefined
        agent.lastActivityAt = Date.now()
      }

      emit()
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
        emit()
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
        emit()
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
        emit()
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
      emit()
      break
    }

    case 'file.created': {
      const agent = findAgentByRuntime(runtimeId)
      if (agent) {
        agent.lastActivityAt = Date.now()
        const filePath = (props.file ?? props.path ?? 'unknown') as string
        trackFileChange(agent.sessionId, filePath, 'created')
        emit()
      }
      break
    }

    case 'file.deleted': {
      const agent = findAgentByRuntime(runtimeId)
      if (agent) {
        agent.lastActivityAt = Date.now()
        const filePath = (props.file ?? props.path ?? 'unknown') as string
        trackFileChange(agent.sessionId, filePath, 'deleted')
        emit()
      }
      break
    }

    case 'server.heartbeat': {
      // Mark healthy
      if (!state.healthy) {
        state.healthy = true
        emit()
      }
      break
    }

    default:
      // Ignore unhandled event types
      break
  }
}

function handleAgentLaunched(payload: AgentLaunchedPayload): void {
  upsertAgent(payload)
  emit()
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

  // Update agent with new session
  agent.sessionId = payload.sessionId
  agent.branchName = payload.branchName
  agent.cost = 0
  agent.tokens = { input: 0, output: 0 }
  agent.lastActivityAt = Date.now()

  const hasPrompt = payload.prompt && payload.prompt.trim().length > 0
  if (hasPrompt) {
    agent.taskSummary = payload.prompt.slice(0, 120)
    agent.status = 'running'
  } else {
    agent.taskSummary = 'Waiting for prompt...'
    agent.status = 'idle'
  }

  emit()
}

function removeAgentState(agentId: string): void {
  const agent = state.agents.get(agentId)
  if (!agent) return

  state.agents.delete(agentId)
  state.messages.delete(agent.sessionId)
  state.fileChanges.delete(agent.sessionId)
  state.eventLog.delete(agent.sessionId)

  for (const [permissionId, permission] of state.permissions.entries()) {
    if (permission.agentId === agentId || permission.sessionId === agent.sessionId) {
      state.permissions.delete(permissionId)
    }
  }
}

function upsertAgent(payload: AgentLaunchedPayload, initialStatus?: AgentStatus): void {
  const hasPrompt = payload.prompt && payload.prompt.trim().length > 0
  const existingAgent = state.agents.get(payload.id)

  // If the agent was launched with a prompt but no explicit title, derive name from prompt
  // If launched without either, mark as autoNamed so the first prompt can rename it
  const hasExplicitTitle = payload.title !== payload.prompt?.slice(0, 80) &&
    !payload.title.match(/^.+-\d+$/) // matches pattern like "project-1" (auto-generated)
  const agentName = hasPrompt
    ? deriveNameFromPrompt(payload.prompt)
    : payload.title.slice(0, 30).replace(/\s+/g, '-').toLowerCase()

  const agent: LiveAgent = {
    id: payload.id,
    runtimeId: payload.runtimeId,
    sessionId: payload.sessionId,
    directory: payload.directory,
    name: payload.displayName || existingAgent?.name || (hasExplicitTitle ? payload.title.slice(0, 30).replace(/\s+/g, '-').toLowerCase() : agentName),
    projectName: payload.projectName || existingAgent?.projectName || payload.directory.split('/').pop() || payload.directory,
    branchName: existingAgent?.branchName ?? payload.branchName ?? '',
    isWorktree: payload.isWorktree ?? existingAgent?.isWorktree ?? false,
    workspaceName: payload.workspaceName ?? existingAgent?.workspaceName ?? payload.directory.split('/').pop() ?? payload.directory,
    taskSummary: payload.taskSummary || existingAgent?.taskSummary || (hasPrompt ? payload.prompt.slice(0, 120) : 'Waiting for prompt...'),
    status: initialStatus ?? existingAgent?.status ?? (hasPrompt ? 'running' : 'idle'),
    model: existingAgent?.model ?? 'starting...',
    lastActivityAt: existingAgent?.lastActivityAt ?? Date.now(),
    cost: existingAgent?.cost ?? 0,
    tokens: existingAgent?.tokens ?? { input: 0, output: 0 },
    autoNamed: !hasExplicitTitle
  }

  state.agents.set(payload.id, agent)
  if (!state.messages.has(payload.sessionId)) state.messages.set(payload.sessionId, [])
  if (!state.fileChanges.has(payload.sessionId)) state.fileChanges.set(payload.sessionId, [])
  if (!state.eventLog.has(payload.sessionId)) state.eventLog.set(payload.sessionId, [])
}

function applyStatuses(statuses: AgentStatusesPayload): void {
  for (const statusEntry of Object.values(statuses)) {
    const agent = state.agents.get(statusEntry.agentId)
    if (!agent) continue

    const nextStatus = mapSessionStatus(statusEntry.status.type)
    agent.status = nextStatus
    if (nextStatus === 'needs_input' || nextStatus === 'needs_approval') {
      agent.blockedSince = agent.blockedSince ?? Date.now()
    } else {
      agent.blockedSince = undefined
    }
  }
}

// ── Helpers ──

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

function formatModelName(modelId: string): string {
  // Claude models: "claude-sonnet-4-20250514" -> "sonnet-4"
  const claudeMatch = modelId.match(/(sonnet|opus|haiku)-?(\d[\d.]*)?/)
  if (claudeMatch) return claudeMatch[0]

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
        for (const agent of agentsResult.data) {
          upsertAgent(agent, 'idle')
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

      if (shouldEmit) emit()
    }

    const cleanups = [
      window.api.onEvent(processEvent),
      window.api.onAgentLaunched(handleAgentLaunched),
      window.api.onSessionReset(handleSessionReset),
      window.api.onEventError((data) => {
        console.error(`[EventError] Runtime ${data.runtimeId}: ${data.error}`)
        state.healthy = false
        emit()
      })
    ]

    void initializeAgents()

    return () => {
      cancelled = true
      for (const cleanup of cleanups) cleanup()
    }
  }, [])

  const agents = Array.from(storeState.agents.values())
  const permissions = Array.from(storeState.permissions.values())

  const launchAgent = useCallback(async (directory: string, prompt?: string, title?: string) => {
    if (!window.api) return
    const result = await window.api.launchAgent({ directory, prompt, title })
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

  const sendMessage = useCallback(async (agentId: string, text: string) => {
    if (!window.api) return

    // Optimistically update task summary and status
    const agent = state.agents.get(agentId)
    if (agent && text.trim()) {
      agent.taskSummary = text.trim().slice(0, 120)
      agent.status = 'running'
      agent.lastActivityAt = Date.now()
      persistAgentMeta(agentId, { taskSummary: agent.taskSummary })
      emit()
    }

    return window.api.sendMessage(agentId, text)
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

  const executeCommand = useCallback(async (agentId: string, command: string, args: string) => {
    if (!window.api) return
    return window.api.executeCommand(agentId, command, args)
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
    emit()
  }, [])

  const respondToPermission = useCallback(async (agentId: string, permissionId: string, response: 'once' | 'always' | 'reject') => {
    if (!window.api) return
    return window.api.respondToPermission(agentId, permissionId, response)
  }, [])

  const abortAgent = useCallback(async (agentId: string) => {
    if (!window.api) return
    return window.api.abortAgent(agentId)
  }, [])

  const resetSession = useCallback(async (agentId: string, prompt?: string) => {
    if (!window.api) return
    return window.api.resetSession(agentId, prompt)
  }, [])

  const removeAgent = useCallback(async (agentId: string) => {
    if (!window.api) return
    const result = await window.api.removeAgent(agentId)
    if (!result.ok) {
      console.error('Failed to remove agent:', result.error)
      return result
    }

    removeAgentState(agentId)
    emit()
    return result
  }, [])

  const selectDirectory = useCallback(async () => {
    if (!window.api) return null
    const result = await window.api.selectDirectory()
    if (result.ok) return result.data ?? null
    return null
  }, [])

  const getMessagesForSession = useCallback((sessionId: string): LiveMessage[] => {
    return storeState.messages.get(sessionId) ?? []
  }, [storeState])

  const getFileChangesForSession = useCallback((sessionId: string): FileChangeRecord[] => {
    return storeState.fileChanges.get(sessionId) ?? []
  }, [storeState])

  const getEventsForSession = useCallback((sessionId: string): EventLogEntry[] => {
    return storeState.eventLog.get(sessionId) ?? []
  }, [storeState])

  const getToolCallsForSession = useCallback((sessionId: string): ToolCallInfo[] => {
    const messages = storeState.messages.get(sessionId) ?? []
    return extractToolCallsFromMessages(messages)
  }, [storeState])

  const renameAgent = useCallback((agentId: string, newName: string) => {
    const agent = state.agents.get(agentId)
    if (!agent) return
    agent.name = newName
    agent.autoNamed = false
    persistAgentMeta(agentId, { displayName: newName })
    emit()
  }, [])

  return {
    agents,
    permissions,
    healthy: storeState.healthy,
    messageVersion: storeState.messageVersion,
    launchAgent,
    sendMessage,
    listCommands,
    executeCommand,
    prepareFreshAgent,
    resetSession,
    respondToPermission,
    abortAgent,
    removeAgent,
    renameAgent,
    selectDirectory,
    getMessagesForSession,
    getFileChangesForSession,
    getEventsForSession,
    getToolCallsForSession
  }
}
