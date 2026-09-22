import type { ToolCall } from '../components/ToolsUsage'
import type { LiveMessage } from '../hooks/useAgentStore'
import type { Message } from '../types'

export function formatResponseMetadata(response: {
  providerID?: string
  model?: string
  variant?: string
}): string | undefined {
  if (!response.model) return undefined

  const parts = response.providerID
    ? [response.providerID, response.model]
    : [response.model]
  const variant = response.variant?.trim()
  if (variant && variant !== 'auto') {
    parts.push(`Effort: ${variant.charAt(0).toUpperCase()}${variant.slice(1)}`)
  }

  return parts.join(' · ')
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
