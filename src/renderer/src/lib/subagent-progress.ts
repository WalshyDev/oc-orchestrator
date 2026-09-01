import type { LiveMessage, LiveMessagePart } from '../hooks/useAgentStore'
import type { Message } from '../types'

export type DisplayToolState = 'running' | 'completed' | 'failed'

export interface ChildTranscriptEntry {
  id: string
  kind: 'text' | 'tool'
  label: string
  toolState?: DisplayToolState
  toolSummary?: string
  toolOutput?: string
  childSessionId?: string
  childTranscript?: ChildTranscriptEntry[]
}

export interface ChildSessionDescriptor {
  id: string
  parentID: string
  title?: string
  updatedAt?: number
}

export interface TaskPartDescriptor {
  toolInput?: string
  childSessionId?: string
}

export function mapToolState(toolState?: string): DisplayToolState {
  if (toolState === 'completed') return 'completed'
  if (toolState === 'error' || toolState === 'failed') return 'failed'
  return 'running'
}

export function getChildSessionId(partState: Record<string, unknown> | undefined): string | undefined {
  const metadata = partState?.metadata as Record<string, unknown> | undefined
  const sessionId = metadata?.sessionId
  return typeof sessionId === 'string' ? sessionId : undefined
}

export function getToolMetadataOutput(partState: Record<string, unknown> | undefined): string | undefined {
  const metadata = partState?.metadata as Record<string, unknown> | undefined
  const output = metadata?.output
  return typeof output === 'string' && output.length > 0 ? output : undefined
}

export function appendVisibleTextDelta(
  messages: LiveMessage[],
  messageId: string,
  partId: string,
  delta: string
): boolean {
  const message = messages.find((candidate) => candidate.id === messageId)
  if (!message) return false
  const part = message.parts.find((candidate) => candidate.id === partId)
  if (!part || part.type !== 'text') return false
  part.text = (part.text ?? '') + delta
  message.updatedAt = Date.now()
  return true
}

export function associateChildSessions(
  taskParts: TaskPartDescriptor[],
  sessions: ChildSessionDescriptor[],
  parentSessionId: string
): void {
  const usedChildIds = new Set(taskParts.map((part) => part.childSessionId).filter(Boolean))
  const unassignedChildren = sessions.filter(
    (info) => info.parentID === parentSessionId && !usedChildIds.has(info.id)
  )
  const unassignedParts = taskParts.filter((part) => !part.childSessionId)

  for (const child of unassignedChildren) {
    const childTitle = child.title?.replace(/\s+\(@.+ subagent\)$/, '').trim()
    const titleMatches = childTitle
      ? unassignedParts.filter((part) => getTaskDescription(part) === childTitle)
      : []
    const hasCorrelationData = !!childTitle || unassignedParts.some((part) => !!getTaskDescription(part))
    const match = titleMatches.length === 1
      ? titleMatches[0]
      : !hasCorrelationData && unassignedChildren.length === 1 && unassignedParts.length === 1
        ? unassignedParts[0]
        : undefined
    if (!match) continue
    match.childSessionId = child.id
    unassignedParts.splice(unassignedParts.indexOf(match), 1)
  }
}

export function mergeLiveMessagePart(existing: LiveMessagePart, next: LiveMessagePart): void {
  const existingTerminal = isTerminalToolState(existing.toolState)
  const nextTerminal = isTerminalToolState(next.toolState)

  existing.type = next.type
  existing.toolName = next.toolName ?? existing.toolName
  existing.toolInput = next.toolInput ?? existing.toolInput
  existing.synthetic = next.synthetic ?? existing.synthetic
  existing.fileMime = next.fileMime ?? existing.fileMime
  existing.fileUrl = next.fileUrl ?? existing.fileUrl
  existing.fileName = next.fileName ?? existing.fileName
  existing.compactionAuto = next.compactionAuto ?? existing.compactionAuto
  existing.compactionOverflow = next.compactionOverflow ?? existing.compactionOverflow
  existing.childSessionId = next.childSessionId ?? existing.childSessionId

  if (!existingTerminal || nextTerminal) {
    existing.toolState = next.toolState ?? existing.toolState
  }

  if (
    next.text !== undefined &&
    (
      existing.text === undefined ||
      (nextTerminal && !existingTerminal) ||
      (!existingTerminal && next.text.length >= existing.text.length)
    )
  ) {
    existing.text = next.text
  }
}

export function collectSessionSubtreeIds(
  sessions: Iterable<ChildSessionDescriptor>,
  rootSessionId: string
): Set<string> {
  const result = new Set([rootSessionId])
  let changed = true
  while (changed) {
    changed = false
    for (const session of sessions) {
      if (!result.has(session.parentID) || result.has(session.id)) continue
      result.add(session.id)
      changed = true
    }
  }
  return result
}

export function buildChildTranscript(
  sessionId: string,
  getMessagesForSession: (sessionId: string) => LiveMessage[],
  ancestors: ReadonlySet<string> = new Set()
): ChildTranscriptEntry[] {
  if (ancestors.has(sessionId)) return []

  const nextAncestors = new Set(ancestors)
  nextAncestors.add(sessionId)
  const entries: ChildTranscriptEntry[] = []

  for (const message of getMessagesForSession(sessionId)) {
    if (message.role !== 'assistant') continue

    for (const part of message.parts) {
      if (part.type === 'text' && part.text) {
        entries.push({ id: part.id, kind: 'text', label: part.text })
      } else if (part.type === 'tool' && part.toolName) {
        entries.push({
          id: part.id,
          kind: 'tool',
          label: part.toolName,
          toolState: mapToolState(part.toolState),
          toolSummary: summarizeChildToolInput(part.toolName, part.toolInput),
          toolOutput: part.text,
          childSessionId: part.childSessionId,
          childTranscript: part.childSessionId
            ? buildChildTranscript(part.childSessionId, getMessagesForSession, nextAncestors)
            : undefined
        })
      }
    }
  }

  return entries
}

export function getLatestChildActivityAt(
  sessionId: string,
  getMessagesForSession: (sessionId: string) => LiveMessage[],
  getSessionUpdatedAt?: (sessionId: string) => number | undefined,
  ancestors: ReadonlySet<string> = new Set()
): number | undefined {
  if (ancestors.has(sessionId)) return undefined

  const nextAncestors = new Set(ancestors)
  nextAncestors.add(sessionId)
  let latest = getSessionUpdatedAt?.(sessionId)

  for (const message of getMessagesForSession(sessionId)) {
    latest = Math.max(latest ?? 0, message.updatedAt ?? message.createdAt)
    for (const part of message.parts) {
      if (!part.childSessionId) continue
      const nested = getLatestChildActivityAt(
        part.childSessionId,
        getMessagesForSession,
        getSessionUpdatedAt,
        nextAncestors
      )
      if (nested !== undefined) latest = Math.max(latest, nested)
    }
  }

  return latest
}

export function orderTranscriptByActivity(messages: Message[]): Message[] {
  return messages
    .flatMap(splitTaskToolGroups)
    .map((message, index) => ({
      message,
      index,
      activityAt: message.toolCalls
        ?.filter((tool) => tool.name === 'task')
        .reduce((latest, tool) => Math.max(latest, tool.childActivityAt ?? latest), message.activityAt ?? 0)
        ?? message.activityAt
        ?? index
    }))
    .sort((left, right) => left.activityAt - right.activityAt || left.index - right.index)
    .map(({ message }) => message)
}

export function splitTaskToolGroups(message: Message): Message[] {
  const tools = message.toolCalls
  if (message.role !== 'tool-group' || !tools?.some((tool) => tool.name === 'task')) {
    return [message]
  }

  const groups = tools.reduce<Array<typeof tools>>((result, tool) => {
    const previous = result[result.length - 1]
    if (tool.name !== 'task' && previous?.every((item) => item.name !== 'task')) {
      previous.push(tool)
    } else {
      result.push([tool])
    }
    return result
  }, [])

  if (groups.length === 1) return [message]
  return groups.map((toolCalls) => ({
    ...message,
    id: `${message.id}-${toolCalls[0].id}`,
    content: `${toolCalls.length} tool call${toolCalls.length === 1 ? '' : 's'}`,
    toolCalls
  }))
}

export function summarizeChildToolInput(name: string, input: string | undefined): string | undefined {
  if (!input) return undefined
  try {
    const parsed = JSON.parse(input) as Record<string, unknown>
    const pick = (...keys: string[]): string | undefined => {
      for (const key of keys) {
        const value = parsed[key]
        if (typeof value === 'string' && value.trim()) return value
      }
      return undefined
    }
    const raw = (() => {
      switch (name.toLowerCase()) {
        case 'bash': return pick('command')
        case 'read': case 'write': case 'edit': return pick('filePath', 'file_path', 'path')
        case 'grep': return pick('pattern')
        case 'glob': return pick('pattern')
        case 'webfetch': return pick('url')
        case 'task': return pick('description', 'prompt')
        default: return undefined
      }
    })()
    if (!raw) return undefined
    const oneLine = raw.replace(/\s+/g, ' ').trim()
    return oneLine.length > 80 ? oneLine.slice(0, 80) + '...' : oneLine
  } catch {
    return undefined
  }
}

function getTaskDescription(part: TaskPartDescriptor): string | undefined {
  if (!part.toolInput) return undefined
  try {
    const input = JSON.parse(part.toolInput) as Record<string, unknown>
    const description = input.description
    return typeof description === 'string' ? description : undefined
  } catch {
    return undefined
  }
}

function isTerminalToolState(state: string | undefined): boolean {
  return state === 'completed' || state === 'error' || state === 'failed'
}
