import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { workspaceManager } from '../main/services/workspace-manager'

describe('git status line counts', () => {
  let root: string
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
  const write = (name: string, content: string | Buffer) => fs.writeFileSync(path.join(root, name), content)
  const status = (name: string) => workspaceManager.getGitStatus(root).find((file) => file.path === name)

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'oco-line-counts-'))
    git('init')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Test')
    git('config', 'commit.gpgsign', 'false')
  })

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  it('counts combined staged and unstaged changes against HEAD', () => {
    write('file.txt', 'one\ntwo\nthree\n')
    git('add', '.')
    git('commit', '-m', 'Initial')
    write('file.txt', 'one\nchanged\nthree\n')
    git('add', '.')
    write('file.txt', 'one\nchanged\nthree\nfour\n')
    expect(status('file.txt')).toMatchObject({ additions: 2, deletions: 1, staged: true, unstaged: true })
  })

  it('counts new files with and without a trailing newline, including empty files', () => {
    write('trailing.txt', 'one\ntwo\n')
    write('no-trailing.txt', 'one\ntwo')
    write('empty.txt', '')
    for (const name of ['trailing.txt', 'no-trailing.txt']) {
      expect(status(name)).toMatchObject({ additions: 2, deletions: 0 })
    }
    expect(status('empty.txt')).toMatchObject({ additions: 0, deletions: 0 })
    git('add', '.')
    expect(status('trailing.txt')).toMatchObject({ additions: 2, deletions: 0, staged: true })
  })

  it('counts deletions and handles paths containing tabs and newlines', () => {
    const name = 'space \t line\n.txt'
    write(name, 'one\ntwo\n')
    git('add', '.')
    git('commit', '-m', 'Initial')
    write(name, 'one\nchanged\n')
    expect(status(name)).toMatchObject({ additions: 1, deletions: 1 })
    fs.unlinkSync(path.join(root, name))
    expect(status(name)).toMatchObject({ additions: 0, deletions: 2 })
  })

  it('attributes rename counts to the new path', () => {
    write('old.txt', 'one\ntwo\nthree\nfour\nfive\n')
    git('add', '.')
    git('commit', '-m', 'Initial')
    git('mv', 'old.txt', 'new name.txt')
    write('new name.txt', 'one\ntwo\nthree\nfour\nfive\nsix\n')
    expect(status('new name.txt')).toMatchObject({ status: 'renamed', additions: 1, deletions: 0 })
  })

  it('reports binary counts as unavailable', () => {
    write('tracked.bin', Buffer.from([0, 1, 2]))
    git('add', '.')
    git('commit', '-m', 'Initial')
    write('tracked.bin', Buffer.from([0, 1, 3]))
    write('new.bin', Buffer.from([0, 4]))
    expect(status('tracked.bin')).toMatchObject({ additions: null, deletions: null })
    expect(status('new.bin')?.additions).toBeUndefined()
  })

  it('refreshes counts after a file is edited', () => {
    write('file.txt', 'one\n')
    expect(status('file.txt')).toMatchObject({ additions: 1, deletions: 0 })
    write('file.txt', 'one\ntwo\n')
    expect(status('file.txt')).toMatchObject({ additions: 2, deletions: 0 })
  })

  it('leaves counts unavailable for oversized new files and symlinks', () => {
    write('large.txt', Buffer.alloc(5 * 1024 * 1024 + 1, 'a'))
    write('target.txt', 'one\ntwo\n')
    fs.symlinkSync('target.txt', path.join(root, 'link.txt'))
    expect(status('large.txt')?.additions).toBeUndefined()
    expect(status('link.txt')?.additions).toBeUndefined()
  })
})
