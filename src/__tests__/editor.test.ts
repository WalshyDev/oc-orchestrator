import { describe, expect, it } from 'vitest'
import { delimiter } from 'node:path'
import { resolveEditorLaunch } from '../main/editor'

describe('editor launching', () => {
  const path = '/tmp/worktree with spaces/it\'s a project; $(touch nope)'

  it.each([
    ['vscode', 'Visual Studio Code'],
    ['cursor', 'Cursor'],
    ['windsurf', 'Windsurf'],
    ['goland', 'GoLand']
  ] as const)('opens %s on macOS without its CLI installed', (editor, app) => {
    expect(resolveEditorLaunch({ editor, path }, 'darwin', { PATH: '/usr/bin:/bin' }))
      .toEqual({ command: 'open', args: ['-a', app, path] })
  })

  it('runs a custom executable with the workspace as one literal argument', () => {
    const launch = resolveEditorLaunch({
      editor: 'custom', path, customCommand: ' /Applications/My Editor/bin/editor '
    }, 'darwin', { PATH: '/usr/bin:/bin', KEEP: 'value' })
    expect(launch.command).toBe('/Applications/My Editor/bin/editor')
    expect(launch.args).toEqual([path])
    expect(launch.env?.KEEP).toBe('value')
    expect(launch.env?.PATH?.split(delimiter)).toContain('/usr/local/bin')
  })

  it('rejects an empty custom command instead of falling back to VS Code', () => {
    expect(() => resolveEditorLaunch({ editor: 'custom', path, customCommand: ' ' }))
      .toThrow('No custom editor command is configured')
  })

  it('preserves the inherited PATH when launching a CLI on Linux', () => {
    const launch = resolveEditorLaunch({ editor: 'vscode', path }, 'linux', {
      PATH: '/my/editor/bin:/usr/bin'
    })
    expect(launch.command).toBe('code')
    expect(launch.args).toEqual([path])
    expect(launch.env?.PATH?.split(delimiter).slice(0, 2))
      .toEqual(['/my/editor/bin', '/usr/bin'])
  })
})
