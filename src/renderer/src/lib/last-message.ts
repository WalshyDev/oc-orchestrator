import type { Message } from '../types'

export function extractLastAssistantMessage(
  messages: { role: string; parts: { type: string; text?: string; synthetic?: boolean }[] }[]
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== 'assistant') continue
    const text = messages[i].parts
      .filter((part) => part.type === 'text' && part.text?.trim() && !part.synthetic)
      .map((part) => part.text!)
      .join(' ')
    if (text) return text.slice(0, 200)
  }
  return undefined
}

export function findLastTranscriptMessageId(
  messages: Message[],
  target: 'last-user-message' | 'last-assistant-message'
): string | undefined {
  const role = target === 'last-user-message' ? 'user' : 'assistant'
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== role) continue
    if (role === 'assistant' && !messages[i].content.trim()) continue
    return messages[i].id
  }
  return undefined
}
