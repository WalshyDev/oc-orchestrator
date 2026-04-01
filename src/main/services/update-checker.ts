import { app, BrowserWindow } from 'electron'

const NPM_REGISTRY_URL = 'https://registry.npmjs.org/oc-orchestrator/latest'
const CHECK_INTERVAL_MS = 4 * 60 * 60_000 // every 4 hours

let timer: ReturnType<typeof setInterval> | null = null

/**
 * Checks the npm registry for a newer version and notifies the renderer.
 */
async function checkForUpdate(): Promise<void> {
  try {
    const response = await fetch(NPM_REGISTRY_URL, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10_000)
    })

    if (!response.ok) return

    const data = await response.json() as { version?: string }
    if (!data.version) return

    const currentVersion = app.getVersion()
    if (data.version !== currentVersion && isNewer(data.version, currentVersion)) {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('update:available', {
          currentVersion,
          latestVersion: data.version
        })
      }
    }
  } catch {
    // Silently ignore — network errors, timeouts, etc.
  }
}

function isNewer(latest: string, current: string): boolean {
  const latestParts = latest.split('.').map(Number)
  const currentParts = current.split('.').map(Number)

  for (let idx = 0; idx < 3; idx++) {
    const latestPart = latestParts[idx] ?? 0
    const currentPart = currentParts[idx] ?? 0
    if (latestPart > currentPart) return true
    if (latestPart < currentPart) return false
  }

  return false
}

export function startUpdateChecker(): void {
  // Check once after a short delay, then periodically
  setTimeout(() => void checkForUpdate(), 30_000)
  timer = setInterval(() => void checkForUpdate(), CHECK_INTERVAL_MS)
}

export function stopUpdateChecker(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
