import type { ToolCall } from '../components/ToolsUsage'
import type { LiveMessage } from '../hooks/useAgentStore'
import type { Message } from '../types'

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
    modelID: anchor.modelId,
    variant: anchor.variant,
    toolCalls
  }
}
