import type { ToolCall } from '../components/ToolsUsage'
import type { LiveMessage } from '../hooks/useAgentStore'
import type { Message } from '../types'

export function formatResponseMetadata(response: {
  providerID?: string
  model?: string
  variant?: string
}): string | undefined {
  if (!response.model) return undefined
  if (!response.providerID) return response.model
  const effort = response.variant
    ? response.variant.charAt(0).toUpperCase() + response.variant.slice(1)
    : 'Provider Default'
  return `${response.providerID} · ${response.model} · Effort: ${effort}`
}

export function buildToolGroupMessage(
  anchor: LiveMessage,
  toolCalls: ToolCall[],
  timestamp: string
): Message {
  return {
    id: `${anchor.id}-tools`,
    role: 'tool-group',
    content: `${toolCalls.length} tool call${toolCalls.length === 1 ? '' : 's'}`,
    timestamp,
    activityAt: anchor.createdAt,
    providerID: anchor.providerID,
    model: [...new Set(toolCalls.map((tool) => tool.model).filter(Boolean))].join(', ') || undefined,
    variant: anchor.variant,
    toolCalls
  }
}
