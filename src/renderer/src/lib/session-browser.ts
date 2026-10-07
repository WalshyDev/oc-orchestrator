import type { SessionListEntry } from '../../../shared/session-browser'

export function matchesSessionSearch(session: SessionListEntry, firstPrompt: string, query: string): boolean {
  if (!query.trim()) return true
  const dates = [session.createdAt, session.updatedAt].filter(Boolean).flatMap((time) => {
    const date = new Date(time)
    return [date.toLocaleDateString(), date.toLocaleString(),
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`]
  })
  return [session.title, session.directory, session.id, firstPrompt, ...dates]
    .join('\n').toLowerCase().includes(query.trim().toLowerCase())
}
