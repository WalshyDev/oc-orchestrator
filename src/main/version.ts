import { app } from 'electron'
import { readFileSync } from 'fs'
import { join } from 'path'

let cached: string | null = null

/**
 * Returns the app version from package.json.
 *
 * In dev mode `app.getVersion()` returns the Electron version (e.g. 41.1.0)
 * instead of our own version, so we read package.json directly.
 */
export function getAppVersion(): string {
  if (cached) return cached

  try {
    const pkgPath = app.isPackaged
      ? join(process.resourcesPath, 'app.asar', 'package.json')
      : join(__dirname, '../../package.json')

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string }
    cached = pkg.version
  } catch {
    cached = app.getVersion()
  }

  return cached
}
