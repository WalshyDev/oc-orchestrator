import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

export type EditorId = 'vscode' | 'cursor' | 'windsurf' | 'goland' | 'custom'

export interface OpenInEditorOptions {
  path: string
  editor: EditorId
  customCommand?: string
}

export interface EditorLaunch {
  command: string
  args: string[]
  env?: NodeJS.ProcessEnv
}

const MAC_APP_NAMES: Record<string, string> = {
  vscode: 'Visual Studio Code',
  cursor: 'Cursor',
  windsurf: 'Windsurf',
  goland: 'GoLand'
}

const EDITOR_COMMANDS: Record<string, string> = {
  vscode: 'code',
  cursor: 'cursor',
  windsurf: 'windsurf',
  goland: 'goland'
}

// Finder and Dock launches need the usual editor install locations on PATH
function launcherPath(currentPath: string | undefined): string {
  const home = homedir()
  const entries = [
    ...(currentPath?.split(delimiter) ?? []),
    join(home, '.local', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin'
  ].filter(Boolean)
  return Array.from(new Set(entries)).join(delimiter)
}

// macOS app bundles work without CLI launchers or interactive shell aliases
export function resolveEditorLaunch(
  options: OpenInEditorOptions,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): EditorLaunch {
  if (options.editor === 'custom') {
    const command = options.customCommand?.trim()
    if (!command) throw new Error('No custom editor command is configured')
    return { command, args: [options.path], env: { ...env, PATH: launcherPath(env.PATH) } }
  }

  const appName = MAC_APP_NAMES[options.editor]
  if (platform === 'darwin' && appName) {
    return { command: 'open', args: ['-a', appName, options.path] }
  }

  const command = EDITOR_COMMANDS[options.editor] ?? 'code'
  return { command, args: [options.path], env: { ...env, PATH: launcherPath(env.PATH) } }
}
