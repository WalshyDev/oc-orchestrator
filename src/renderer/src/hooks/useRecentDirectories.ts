import { useMemo, useSyncExternalStore } from 'react'

export const RECENT_DIRECTORIES_STORAGE_KEY = 'oc-orchestrator:recent-directories'
const CHANGED_EVENT = 'oc-orchestrator:recent-directories-changed'
const MAX_RECENT_DIRECTORIES = 5
let fallbackSnapshot = '[]'
let pendingSnapshot: string | null = null

function getSnapshot(): string {
  if (pendingSnapshot !== null) return pendingSnapshot
  try {
    return localStorage.getItem(RECENT_DIRECTORIES_STORAGE_KEY) ?? '[]'
  } catch {
    return fallbackSnapshot
  }
}

function parseHistory(snapshot: string): string[] {
  try {
    const values: unknown = JSON.parse(snapshot)
    if (!Array.isArray(values)) return []
    return [...new Set(values.filter((value): value is string =>
      typeof value === 'string' && !!value.trim()
    ).map((value) => value.trim()))].slice(0, MAX_RECENT_DIRECTORIES)
  } catch {
    return []
  }
}

function saveHistory(directories: string[]): void {
  fallbackSnapshot = JSON.stringify(directories)
  try {
    localStorage.setItem(RECENT_DIRECTORIES_STORAGE_KEY, fallbackSnapshot)
    pendingSnapshot = null
  } catch {
    pendingSnapshot = fallbackSnapshot
  }
  window.dispatchEvent(new Event(CHANGED_EVENT))
}

export function recordRecentDirectory(directory: string): void {
  const path = directory.trim()
  if (!path) return
  saveHistory([path, ...parseHistory(getSnapshot()).filter((entry) => entry !== path)].slice(0, MAX_RECENT_DIRECTORIES))
}

export function removeRecentDirectory(directory: string): void {
  saveHistory(parseHistory(getSnapshot()).filter((entry) => entry !== directory.trim()))
}

function subscribe(listener: () => void): () => void {
  const onStorage = (event: StorageEvent): void => {
    if (event.key === RECENT_DIRECTORIES_STORAGE_KEY || event.key === null) listener()
  }
  window.addEventListener(CHANGED_EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(CHANGED_EVENT, listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useRecentDirectories(): string[] {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return useMemo(() => parseHistory(snapshot), [snapshot])
}
