import type { OpencodeClient } from '@opencode-ai/sdk/v2/client'

export async function collectChildSessionIds(
  client: OpencodeClient,
  rootSessionId: string,
  directory: string
): Promise<Set<string>> {
  const result = new Set<string>()
  const pending = [rootSessionId]

  while (pending.length > 0) {
    const parentSessionId = pending.shift()!
    if (result.has(parentSessionId)) continue
    result.add(parentSessionId)

    const childrenResult = await client.session.children({
      sessionID: parentSessionId,
      directory
    })
    pending.push(...(childrenResult.data ?? []).map((child) => child.id))
  }

  return result
}

export async function buildSessionOwnerIndex(
  client: OpencodeClient,
  roots: Array<{ agentId: string; sessionId: string }>,
  directory: string
): Promise<{ owners: Map<string, string>; incompleteAgentIds: Set<string> }> {
  const owners = new Map(roots.map((root) => [root.sessionId, root.agentId]))
  const incompleteAgentIds = new Set<string>()
  await Promise.all(roots.map(async (root) => {
    try {
      const sessionIds = await collectChildSessionIds(client, root.sessionId, directory)
      for (const sessionId of sessionIds) owners.set(sessionId, root.agentId)
    } catch {
      incompleteAgentIds.add(root.agentId)
    }
  }))
  return { owners, incompleteAgentIds }
}

export function groupRequestsByOwner<T extends { sessionID: string }>(
  agentIds: string[],
  owners: ReadonlyMap<string, string>,
  requests: T[]
): Array<{ agentId: string; requests: T[] }> {
  const grouped = new Map(agentIds.map((agentId) => [agentId, [] as T[]]))
  for (const request of requests) {
    const agentId = owners.get(request.sessionID)
    if (agentId) grouped.get(agentId)?.push(request)
  }
  return agentIds.map((agentId) => ({ agentId, requests: grouped.get(agentId) ?? [] }))
}

export async function collectChildSessionTranscripts(
  client: OpencodeClient,
  rootSessionId: string,
  directory: string
): Promise<{ sessions: Array<{ info: unknown; messages: unknown }>; complete: boolean }> {
  const result: Array<{ info: unknown; messages: unknown }> = []
  const visited = new Set<string>()
  const pending = [rootSessionId]
  let complete = true

  while (pending.length > 0) {
    const parentSessionId = pending.shift()!
    if (visited.has(parentSessionId)) continue
    visited.add(parentSessionId)

    let childrenResult
    try {
      childrenResult = await client.session.children({
        sessionID: parentSessionId,
        directory
      })
    } catch {
      complete = false
      continue
    }
    const children = childrenResult.data ?? []
    const hydrated = await Promise.all(children.map(async (child) => {
      try {
        const messagesResult = await client.session.messages({
          sessionID: child.id,
          directory
        })
        return { info: child, messages: messagesResult.data ?? [] }
      } catch {
        complete = false
        return { info: child, messages: [] }
      }
    }))

    result.push(...hydrated)
    pending.push(...children.map((child) => child.id))
  }

  return { sessions: result, complete }
}
