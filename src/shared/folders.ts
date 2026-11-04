export interface AgentFolder {
  id: string
  name: string
  sortOrder: number
}

export interface FolderSnapshot {
  folders: AgentFolder[]
  membership: Record<string, string>
}
