import type { LiveMessage, LiveMessagePart } from '../hooks/useAgentStore'
import type { MessageAttachment } from '../types/api'

export const OPTIMISTIC_PREFIX = 'optimistic-user-'

let optimisticCounter = 0

export function createOptimisticUserMessage(
  sessionId: string,
  text: string,
  attachments?: MessageAttachment[],
  modelId?: string
): LiveMessage | null {
  const hasText = text.trim().length > 0
  if (!hasText && !attachments?.length) return null

  const id = `${OPTIMISTIC_PREFIX}${++optimisticCounter}`
  const now = Date.now()
  const parts: LiveMessagePart[] = []
  if (hasText) {
    parts.push({ id: `${id}-part`, type: 'text', text })
  }
  attachments?.forEach((attachment, index) => {
    parts.push({
      id: `${id}-file-${index}`,
      type: 'file',
      fileMime: attachment.mime,
      fileUrl: attachment.dataUrl,
      fileName: attachment.filename
    })
  })

  return {
    id,
    role: 'user',
    sessionId,
    createdAt: now,
    updatedAt: now,
    modelId,
    parts
  }
}

export function replaceNextOptimisticUserFilePart(message: LiveMessage, serverPart: LiveMessagePart): boolean {
  if (message.role !== 'user' || serverPart.type !== 'file') return false

  const optimisticIndex = message.parts.findIndex((part) =>
    part.type === 'file' && part.id.startsWith(OPTIMISTIC_PREFIX)
  )
  if (optimisticIndex < 0) return false

  message.parts[optimisticIndex] = serverPart
  return true
}
