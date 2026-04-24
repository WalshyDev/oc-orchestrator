import fs from 'fs'
import type { BrowserWindow } from 'electron'

/**
 * Narrow file watcher: one `fs.watch` per (agentId, relativePath) subscription.
 * Sends `file:changed` events to the subscribing renderer when the on-disk
 * file is modified, debounced so save operations (which often fire change +
 * rename in quick succession) coalesce into a single notification.
 *
 * Deliberately NOT a recursive worktree watcher. A large repo's worktree
 * generates huge event volumes during test runs, builds, and lockfile churn.
 * We only care about the file(s) the user has open in the editor.
 *
 * Keyed by a caller-provided subscription id so the renderer can correlate
 * replies to open editors (e.g. different files in different tabs later).
 */

interface Subscription {
  id: string
  window: BrowserWindow
  absPath: string
  watcher: fs.FSWatcher
  debounceTimer?: NodeJS.Timeout
}

const DEBOUNCE_MS = 150
const subscriptions = new Map<string, Subscription>()

export function subscribeFileChanges(
  window: BrowserWindow,
  subscriptionId: string,
  absPath: string
): void {
  // Replace any existing subscription with the same id — e.g. the renderer
  // switches files in the editor and reuses the id.
  unsubscribeFileChanges(subscriptionId)

  // Watching a non-existent file throws. This happens for brand-new files
  // the user is about to create; the renderer can retry after first save.
  let watcher: fs.FSWatcher
  try {
    watcher = fs.watch(absPath)
  } catch (error) {
    // Best-effort: emit an immediate error so the renderer knows the watch
    // didn't take. The UI can fall back to on-focus polling.
    window.webContents.send('file:changed', {
      subscriptionId,
      event: 'error',
      error: String(error)
    })
    return
  }

  const sub: Subscription = { id: subscriptionId, window, absPath, watcher }

  watcher.on('change', (eventType) => {
    if (sub.debounceTimer) clearTimeout(sub.debounceTimer)
    sub.debounceTimer = setTimeout(() => {
      sub.debounceTimer = undefined
      if (window.isDestroyed()) {
        unsubscribeFileChanges(subscriptionId)
        return
      }
      // Stat to get the new mtime so the renderer can decide if this is a
      // real change (mtime bumped) vs a no-op touch.
      let mtimeMs: number | null = null
      try {
        mtimeMs = fs.statSync(absPath).mtimeMs
      } catch {
        // File may have been deleted.
        window.webContents.send('file:changed', {
          subscriptionId,
          event: 'deleted',
          absPath
        })
        return
      }
      window.webContents.send('file:changed', {
        subscriptionId,
        event: eventType === 'rename' ? 'renamed' : 'changed',
        absPath,
        mtimeMs
      })
    }, DEBOUNCE_MS)
  })

  watcher.on('error', (error) => {
    if (!window.isDestroyed()) {
      window.webContents.send('file:changed', {
        subscriptionId,
        event: 'error',
        error: String(error)
      })
    }
    unsubscribeFileChanges(subscriptionId)
  })

  subscriptions.set(subscriptionId, sub)
}

export function unsubscribeFileChanges(subscriptionId: string): void {
  const sub = subscriptions.get(subscriptionId)
  if (!sub) return
  if (sub.debounceTimer) clearTimeout(sub.debounceTimer)
  try { sub.watcher.close() } catch { /* ignore */ }
  subscriptions.delete(subscriptionId)
}

/** Tear down all subscriptions belonging to a window (on window close). */
export function unsubscribeAllForWindow(window: BrowserWindow): void {
  for (const [id, sub] of subscriptions) {
    if (sub.window === window) {
      unsubscribeFileChanges(id)
    }
  }
}
