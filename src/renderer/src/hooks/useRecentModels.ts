import { useMemo, useSyncExternalStore } from 'react'

export const RECENT_MODELS_STORAGE_KEY = 'oc-orchestrator:recent-models'
const RECENT_MODELS_CHANGED_EVENT = 'oc-orchestrator:recent-models-changed'
const MAX_RECENT_MODELS = 5
let fallbackSnapshot = '[]'
let pendingSnapshot: string | null = null

interface RecentModelUse {
  model: string
  usedAt: number
}

function getSnapshot(): string {
  if (pendingSnapshot !== null) return pendingSnapshot
  try {
    return localStorage.getItem(RECENT_MODELS_STORAGE_KEY) ?? '[]'
  } catch {
    return fallbackSnapshot
  }
}

function parseHistory(snapshot: string): RecentModelUse[] {
  try {
    const values: unknown = JSON.parse(snapshot)
    if (!Array.isArray(values)) return []
    const entries = values.flatMap((value): RecentModelUse[] => {
      const entry = typeof value === 'string' ? { model: value, usedAt: 0 } : value
      if (!entry || typeof entry.model !== 'string' || !entry.model.trim() || entry.model === 'auto' ||
        typeof entry.usedAt !== 'number' || !Number.isFinite(entry.usedAt) || entry.usedAt < 0) return []
      return [{ model: entry.model, usedAt: entry.usedAt }]
    }).sort((a, b) => b.usedAt - a.usedAt)
    return entries.filter((entry, index) => entries.findIndex((other) => other.model === entry.model) === index).slice(0, MAX_RECENT_MODELS)
  } catch {
    return []
  }
}

export function recordRecentModel(model: string, usedAt?: number): void {
  const timestamp = usedAt ?? Date.now()
  if (!model.trim() || model === 'auto' || !Number.isFinite(timestamp) || timestamp < 0) return
  const history = parseHistory(getSnapshot())
  const previous = history.find((entry) => entry.model === model)
  let updated = history
  if (usedAt === undefined || !previous || previous.usedAt < timestamp) {
    updated = [{ model, usedAt: timestamp }, ...history.filter((entry) => entry.model !== model)]
      .sort((a, b) => b.usedAt - a.usedAt).slice(0, MAX_RECENT_MODELS)
  }
  if (pendingSnapshot === null && JSON.stringify(updated) === JSON.stringify(history)) return
  fallbackSnapshot = JSON.stringify(updated)
  try {
    localStorage.setItem(RECENT_MODELS_STORAGE_KEY, fallbackSnapshot)
    pendingSnapshot = null
  } catch {
    pendingSnapshot = fallbackSnapshot
  }
  window.dispatchEvent(new Event(RECENT_MODELS_CHANGED_EVENT))
}

function subscribe(listener: () => void): () => void {
  const onStorage = (event: StorageEvent): void => {
    if (event.key === RECENT_MODELS_STORAGE_KEY || event.key === null) listener()
  }
  window.addEventListener(RECENT_MODELS_CHANGED_EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(RECENT_MODELS_CHANGED_EVENT, listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useRecentModels(): string[] {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return useMemo(() => parseHistory(snapshot).map((entry) => entry.model), [snapshot])
}

export function prioritizeRecentOptions<T extends { value: string }>(
  options: readonly T[],
  recentModels: readonly string[]
): readonly T[] {
  const recentOptions = recentModels.flatMap((value) => {
    const option = options.find((option) => option.value === value)
    return option ? [option] : []
  })
  const recentValues = new Set(recentOptions.map((option) => option.value))
  return [...recentOptions, ...options.filter((option) => !recentValues.has(option.value))]
}
