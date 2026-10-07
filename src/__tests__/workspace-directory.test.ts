import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { workspaceManager } from '../main/services/workspace-manager'

describe('workspace directory validation', () => {
  it('accepts folders outside Git and rejects files and missing paths', () => {
    const directory = mkdtempSync(join(tmpdir(), 'oco-directory-'))
    try {
      const file = join(directory, 'file.txt')
      writeFileSync(file, 'content')
      expect(workspaceManager.isDirectory(directory)).toBe(true)
      expect(workspaceManager.isGitRepo(directory)).toBe(false)
      expect(workspaceManager.isDirectory(file)).toBe(false)
      expect(workspaceManager.isDirectory(join(directory, 'missing'))).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
