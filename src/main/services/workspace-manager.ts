import { execSync } from 'child_process'
import path from 'path'
import fs from 'fs'
import os from 'os'

export interface WorktreeInfo {
  worktreePath: string
  branchName: string
}

export interface FreshWorktreeInfo extends WorktreeInfo {
  baseRef: string
}

export interface WorktreeListEntry {
  path: string
  head: string
  branch: string
}

export interface WorktreeStatus {
  dirty: boolean
  changedFiles: number
}

export interface DirectoryContext {
  repoName: string
  branchName: string
  isWorktree: boolean
  workspaceName: string
}

/**
 * Manages Git worktrees for agent isolation.
 * Each agent task gets its own worktree so work can proceed in parallel
 * without branch conflicts.
 */
class WorkspaceManager {
  private claimedWorktrees = new Set<string>()

  /**
   * Returns the managed root directory for worktrees.
   * Creates the directory if it does not exist.
   */
  getWorktreeRoot(): string {
    const rootDir = path.join(os.homedir(), '.oc-orchestrator', 'worktrees')
    if (!fs.existsSync(rootDir)) {
      fs.mkdirSync(rootDir, { recursive: true })
      console.log(`[WorkspaceManager] Created worktree root: ${rootDir}`)
    }
    return rootDir
  }

  /**
   * Creates a new git worktree for an agent task.
   * The worktree gets its own branch based on HEAD so the agent
   * can work independently.
   */
  createWorktree(repoRoot: string, projectSlug: string, taskSlug: string): WorktreeInfo {
    const timestamp = Date.now()
    const branchName = `${projectSlug}/${taskSlug}-${timestamp}`
    const worktreeRoot = this.getWorktreeRoot()
    const worktreePath = path.join(worktreeRoot, projectSlug, `${taskSlug}-${timestamp}`)

    try {
      // Ensure the parent directory exists
      const parentDir = path.dirname(worktreePath)
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true })
      }

      console.log(`[WorkspaceManager] Creating worktree at ${worktreePath} on branch ${branchName}`)

      execSync(`git worktree add -b "${branchName}" "${worktreePath}" HEAD`, {
        cwd: repoRoot,
        encoding: 'utf-8',
        stdio: 'pipe'
      })

      console.log(`[WorkspaceManager] Worktree created successfully`)

      return { worktreePath, branchName }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[WorkspaceManager] Failed to create worktree: ${message}`)
      throw new Error(`Failed to create worktree: ${message}`)
    }
  }

  /**
   * Creates a fresh worktree based on the latest default branch from origin.
   */
  createFreshWorktree(repoRoot: string, projectSlug: string, taskSlug: string): FreshWorktreeInfo {
    const timestamp = Date.now()
    const branchName = `${projectSlug}/${taskSlug}-${timestamp}`
    const worktreeRoot = this.getWorktreeRoot()
    const worktreePath = path.join(worktreeRoot, projectSlug, `${taskSlug}-${timestamp}`)

    try {
      const parentDir = path.dirname(worktreePath)
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true })
      }

      execSync('git fetch origin --prune', {
        cwd: repoRoot,
        encoding: 'utf-8',
        stdio: 'pipe'
      })

      const baseRef = this.getDefaultBaseRef(repoRoot)

      console.log(`[WorkspaceManager] Creating fresh worktree at ${worktreePath} from ${baseRef}`)

      execSync(`git worktree add -b "${branchName}" "${worktreePath}" "${baseRef}"`, {
        cwd: repoRoot,
        encoding: 'utf-8',
        stdio: 'pipe'
      })

      console.log('[WorkspaceManager] Fresh worktree created successfully')

      return { worktreePath, branchName, baseRef }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[WorkspaceManager] Failed to create fresh worktree: ${message}`)
      throw new Error(`Failed to create fresh worktree: ${message}`)
    }
  }

  /**
   * Removes a worktree and prunes stale worktree references.
   */
  removeWorktree(repoRoot: string, worktreePath: string): void {
    try {
      console.log(`[WorkspaceManager] Removing worktree at ${worktreePath}`)

      execSync(`git worktree remove "${worktreePath}" --force`, {
        cwd: repoRoot,
        encoding: 'utf-8',
        stdio: 'pipe'
      })

      execSync('git worktree prune', {
        cwd: repoRoot,
        encoding: 'utf-8',
        stdio: 'pipe'
      })

      // Release the claim if it was claimed
      this.claimedWorktrees.delete(worktreePath)

      console.log(`[WorkspaceManager] Worktree removed and pruned`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[WorkspaceManager] Failed to remove worktree: ${message}`)
      throw new Error(`Failed to remove worktree: ${message}`)
    }
  }

  /**
   * Lists all worktrees for a given repo.
   */
  listWorktrees(repoRoot: string): WorktreeListEntry[] {
    try {
      const output = execSync('git worktree list --porcelain', {
        cwd: repoRoot,
        encoding: 'utf-8',
        stdio: 'pipe'
      })

      const entries: WorktreeListEntry[] = []
      const blocks = output.trim().split('\n\n')

      for (const block of blocks) {
        if (!block.trim()) continue

        const lines = block.trim().split('\n')
        let worktreePath = ''
        let head = ''
        let branch = ''

        for (const line of lines) {
          if (line.startsWith('worktree ')) {
            worktreePath = line.replace('worktree ', '')
          } else if (line.startsWith('HEAD ')) {
            head = line.replace('HEAD ', '')
          } else if (line.startsWith('branch ')) {
            branch = line.replace('branch refs/heads/', '')
          }
        }

        if (worktreePath) {
          entries.push({ path: worktreePath, head, branch })
        }
      }

      return entries
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[WorkspaceManager] Failed to list worktrees: ${message}`)
      throw new Error(`Failed to list worktrees: ${message}`)
    }
  }

  /**
   * Validates whether a directory is a git repository.
   */
  isGitRepo(directory: string): boolean {
    try {
      execSync('git rev-parse --is-inside-work-tree', {
        cwd: directory,
        encoding: 'utf-8',
        stdio: 'pipe'
      })
      return true
    } catch {
      return false
    }
  }

  /**
   * Gets the root of a git repository from any path within it.
   */
  getRepoRoot(directory: string): string {
    try {
      const root = execSync('git rev-parse --show-toplevel', {
        cwd: directory,
        encoding: 'utf-8',
        stdio: 'pipe'
      })
      return root.trim()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[WorkspaceManager] Failed to get repo root: ${message}`)
      throw new Error(`Failed to get repo root: ${message}`)
    }
  }

  getCommonRepoRoot(directory: string): string {
    try {
      const gitCommonDir = execSync('git rev-parse --path-format=absolute --git-common-dir', {
        cwd: directory,
        encoding: 'utf-8',
        stdio: 'pipe'
      }).trim()

      return path.dirname(gitCommonDir)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[WorkspaceManager] Failed to get common repo root: ${message}`)
      throw new Error(`Failed to get common repo root: ${message}`)
    }
  }

  /**
   * Gets the current branch name for a directory.
   */
  getCurrentBranch(directory: string): string {
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: directory,
        encoding: 'utf-8',
        stdio: 'pipe'
      })
      return branch.trim()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[WorkspaceManager] Failed to get current branch: ${message}`)
      throw new Error(`Failed to get current branch: ${message}`)
    }
  }

  getDirectoryContext(directory: string): DirectoryContext {
    try {
      const workspaceRoot = execSync('git rev-parse --show-toplevel', {
        cwd: directory,
        encoding: 'utf-8',
        stdio: 'pipe'
      }).trim()

      const gitDir = execSync('git rev-parse --path-format=absolute --git-dir', {
        cwd: directory,
        encoding: 'utf-8',
        stdio: 'pipe'
      }).trim()

      const gitCommonDir = execSync('git rev-parse --path-format=absolute --git-common-dir', {
        cwd: directory,
        encoding: 'utf-8',
        stdio: 'pipe'
      }).trim()

      const repoRoot = path.dirname(gitCommonDir)

      return {
        repoName: path.basename(repoRoot),
        branchName: this.getCurrentBranch(directory),
        isWorktree: path.normalize(gitDir) !== path.normalize(gitCommonDir),
        workspaceName: path.basename(workspaceRoot)
      }
    } catch (error) {
      const fallbackName = path.basename(directory)
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[WorkspaceManager] Failed to get directory context: ${message}`)
      return {
        repoName: fallbackName,
        branchName: '',
        isWorktree: false,
        workspaceName: fallbackName
      }
    }
  }

  private getDefaultBaseRef(repoRoot: string): string {
    try {
      const remoteHead = execSync('git symbolic-ref refs/remotes/origin/HEAD', {
        cwd: repoRoot,
        encoding: 'utf-8',
        stdio: 'pipe'
      }).trim()

      return remoteHead.replace('refs/remotes/', '')
    } catch {
      return 'origin/main'
    }
  }

  /**
   * Checks if a worktree has uncommitted changes.
   */
  getWorktreeStatus(worktreePath: string): WorktreeStatus {
    try {
      const output = execSync('git status --porcelain', {
        cwd: worktreePath,
        encoding: 'utf-8',
        stdio: 'pipe'
      })

      const changedLines = output.trim().split('\n').filter((line) => line.trim().length > 0)
      const changedFiles = changedLines.length

      return {
        dirty: changedFiles > 0,
        changedFiles
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[WorkspaceManager] Failed to get worktree status: ${message}`)
      throw new Error(`Failed to get worktree status: ${message}`)
    }
  }

  /**
   * Claims a worktree so no other runtime can use it.
   * Throws if the worktree is already claimed.
   */
  claimWorktree(worktreeId: string): void {
    if (this.claimedWorktrees.has(worktreeId)) {
      throw new Error(`Worktree "${worktreeId}" is already claimed by another runtime`)
    }
    this.claimedWorktrees.add(worktreeId)
    console.log(`[WorkspaceManager] Claimed worktree: ${worktreeId}`)
  }

  /**
   * Releases a previously claimed worktree so it can be used again.
   */
  releaseWorktree(worktreeId: string): void {
    if (!this.claimedWorktrees.has(worktreeId)) {
      console.warn(`[WorkspaceManager] Attempted to release unclaimed worktree: ${worktreeId}`)
      return
    }
    this.claimedWorktrees.delete(worktreeId)
    console.log(`[WorkspaceManager] Released worktree: ${worktreeId}`)
  }
}

export const workspaceManager = new WorkspaceManager()
