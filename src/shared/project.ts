export type WorktreeStrategy = 'new-worktree' | 'current-directory'

export interface ProjectSettings {
  default_branch?: string | null
  fresh_worktree?: boolean
  worktree_strategy?: WorktreeStrategy | null
}

export function isWorktreeStrategy(value: unknown): value is WorktreeStrategy {
  return value === 'new-worktree' || value === 'current-directory'
}

/**
 * Match OpenCode's fork title style so imported sessions stay easy to scan.
 * Shared because the renderer predicts this name for its optimistic launch row —
 * if the two drift, the row visibly renames itself when the real agent lands.
 */
export function getForkedTitle(title: string): string {
  const match = title.match(/^(.*?)\s*\(fork(?:\s*#(\d+))?\)\s*$/)
  if (match) {
    const base = match[1].trim()
    const num = match[2] ? parseInt(match[2], 10) + 1 : 2
    return `${base} (fork #${num})`
  }
  return `${title} (fork)`
}
