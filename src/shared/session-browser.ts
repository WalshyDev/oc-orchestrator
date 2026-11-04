export interface SessionListEntry {
  id: string
  title: string
  directory: string
  createdAt: number
  updatedAt: number
}

export interface SessionListPage {
  sessions: SessionListEntry[]
  hasMore: boolean
}
