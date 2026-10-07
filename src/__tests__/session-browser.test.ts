import { describe, expect, it } from 'vitest'
import { matchesSessionSearch } from '../renderer/src/lib/session-browser'
import type { SessionListEntry } from '../shared/session-browser'

describe('restore session search', () => {
  const session: SessionListEntry = {
    id: 'ses_deleted', title: 'QuickStart-random', directory: '/Users/example',
    createdAt: new Date(2026, 9, 7, 9, 30).getTime(),
    updatedAt: new Date(2026, 9, 8, 10, 30).getTime()
  }

  it.each(['quickstart', '  certificate renewal  ', '2026-10-07', '2026-10-08', '/Users/example', 'ses_deleted', ''])('finds a session by %s', (query) => {
    expect(matchesSessionSearch(session, 'Investigate certificate renewal failures', query)).toBe(true)
  })

  it('rejects an unrelated prompt and handles sessions without dates or prompts', () => {
    expect(matchesSessionSearch(session, '', 'certificate')).toBe(false)
    expect(matchesSessionSearch({ ...session, createdAt: 0, updatedAt: 0 }, '', '1970')).toBe(false)
  })
})
