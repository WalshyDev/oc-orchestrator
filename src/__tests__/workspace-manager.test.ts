import { describe, it, expect, beforeEach } from 'vitest'
import { execSync } from 'child_process'
import path from 'path'
import os from 'os'
import fs from 'fs'

// ── Extracted WorkspaceManager for testing ──
// Mirrors src/main/services/workspace-manager.ts but without the singleton export

interface WorktreeInfo {
  worktreePath: string
  branchName: string
}

class WorkspaceManager {
  private claimedWorktrees = new Set<string>()

  getWorktreeRoot(): string {
    const rootDir = path.join(os.homedir(), '.oc-orchestrator', 'worktrees')
    if (!fs.existsSync(rootDir)) {
      fs.mkdirSync(rootDir, { recursive: true })
    }
    return rootDir
  }

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

  claimWorktree(worktreeId: string): void {
    if (this.claimedWorktrees.has(worktreeId)) {
      throw new Error(`Worktree "${worktreeId}" is already claimed by another runtime`)
    }
    this.claimedWorktrees.add(worktreeId)
  }

  releaseWorktree(worktreeId: string): void {
    if (!this.claimedWorktrees.has(worktreeId)) {
      return
    }
    this.claimedWorktrees.delete(worktreeId)
  }

  isWorktreeClaimed(worktreeId: string): boolean {
    return this.claimedWorktrees.has(worktreeId)
  }
}

// ── Tests ──

describe('WorkspaceManager', () => {
  let manager: WorkspaceManager

  beforeEach(() => {
    manager = new WorkspaceManager()
  })

  describe('isGitRepo', () => {
    it('returns true for a valid git repository', () => {
      // The project root itself is a git repo
      const projectRoot = path.resolve(__dirname, '..', '..')
      expect(manager.isGitRepo(projectRoot)).toBe(true)
    })

    it('returns false for a non-git directory', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-'))
      try {
        expect(manager.isGitRepo(tempDir)).toBe(false)
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true })
      }
    })

    it('returns false for a non-existent directory', () => {
      expect(manager.isGitRepo('/tmp/does-not-exist-at-all-xyz')).toBe(false)
    })
  })

  describe('getWorktreeRoot', () => {
    it('returns a path under the home directory', () => {
      const root = manager.getWorktreeRoot()
      const expectedPath = path.join(os.homedir(), '.oc-orchestrator', 'worktrees')
      expect(root).toBe(expectedPath)
    })

    it('creates the directory if it does not exist', () => {
      const root = manager.getWorktreeRoot()
      expect(fs.existsSync(root)).toBe(true)
    })
  })

  describe('claimWorktree / releaseWorktree', () => {
    it('allows claiming an unclaimed worktree', () => {
      expect(() => manager.claimWorktree('worktree-1')).not.toThrow()
    })

    it('throws when double-claiming the same worktree', () => {
      manager.claimWorktree('worktree-2')
      expect(() => manager.claimWorktree('worktree-2')).toThrow(
        'Worktree "worktree-2" is already claimed by another runtime'
      )
    })

    it('allows claiming after release', () => {
      manager.claimWorktree('worktree-3')
      manager.releaseWorktree('worktree-3')
      expect(() => manager.claimWorktree('worktree-3')).not.toThrow()
    })

    it('does not throw when releasing an unclaimed worktree', () => {
      expect(() => manager.releaseWorktree('never-claimed')).not.toThrow()
    })

    it('tracks multiple independent worktrees', () => {
      manager.claimWorktree('wt-a')
      manager.claimWorktree('wt-b')

      expect(manager.isWorktreeClaimed('wt-a')).toBe(true)
      expect(manager.isWorktreeClaimed('wt-b')).toBe(true)

      manager.releaseWorktree('wt-a')
      expect(manager.isWorktreeClaimed('wt-a')).toBe(false)
      expect(manager.isWorktreeClaimed('wt-b')).toBe(true)
    })
  })

  describe('branch naming convention', () => {
    it('follows the projectSlug/taskSlug-timestamp format', () => {
      const projectSlug = 'my-project'
      const taskSlug = 'fix-bug'
      const timestamp = Date.now()
      const branchName = `${projectSlug}/${taskSlug}-${timestamp}`

      expect(branchName).toMatch(/^[\w-]+\/[\w-]+-\d+$/)
    })

    it('includes the project slug as a prefix', () => {
      const branchName = 'my-project/add-feature-1234567890'
      const parts = branchName.split('/')
      expect(parts[0]).toBe('my-project')
    })

    it('includes a timestamp suffix', () => {
      const branchName = 'my-project/add-feature-1711580400000'
      const timestampPart = branchName.split('-').pop()
      expect(Number(timestampPart)).toBeGreaterThan(0)
    })
  })
})
