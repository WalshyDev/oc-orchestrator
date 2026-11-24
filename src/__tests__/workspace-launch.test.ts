import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { expect, it, vi } from 'vitest'
import { workspaceManager } from '../main/services/workspace-manager'

it.each(['current', 'fresh'])('services other work while Git is checking out a %s worktree', async (strategy) => {
  const root = mkdtempSync(join(tmpdir(), 'oco-workspace-launch-'))
  const repo = join(root, 'repo')
  mkdirSync(repo)
  const worktreeRoot = vi.spyOn(workspaceManager, 'getWorktreeRoot').mockReturnValue(join(root, 'worktrees'))
  let launch: Promise<unknown> | undefined
  try {
    execFileSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: repo })
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--allow-empty', '-qm', 'Initial commit'], { cwd: repo })
    const hook = join(repo, '.git/hooks/post-checkout')
    writeFileSync(hook, '#!/bin/sh\ntouch ../checkout-started\nsleep 1\n', { mode: 0o755 })
    execFileSync('git', ['config', 'core.hooksPath', join(repo, '.git/hooks')], { cwd: repo })

    if (strategy === 'fresh') execFileSync('git', ['remote', 'add', 'origin', '.'], { cwd: repo })
    launch = Promise.resolve(strategy === 'fresh'
      ? workspaceManager.createFreshWorktree(repo, 'project', 'new-task', 'origin/main')
      : workspaceManager.createWorktree(repo, 'project', 'new-task'))
    const serviceAnotherRequest = async () => {
      await delay(10)
      await vi.waitFor(() => expect(existsSync(join(root, 'worktrees/project/checkout-started'))).toBe(true))
      return 'responsive'
    }
    await expect(Promise.race([launch.then(() => 'finished'), serviceAnotherRequest()])).resolves.toBe('responsive')
    await expect(launch).resolves.toMatchObject({ branchName: expect.stringMatching(/^project\/new-task-/) })
  } finally {
    await launch?.catch(() => {})
    worktreeRoot.mockRestore()
    rmSync(root, { recursive: true, force: true })
  }
})
