export type WorktreeStrategy = 'new-worktree' | 'current-directory'

export interface ProjectSettings {
  default_branch?: string | null
  fresh_worktree?: boolean
  worktree_strategy?: WorktreeStrategy | null
}

export function isWorktreeStrategy(value: unknown): value is WorktreeStrategy {
  return value === 'new-worktree' || value === 'current-directory'
}
