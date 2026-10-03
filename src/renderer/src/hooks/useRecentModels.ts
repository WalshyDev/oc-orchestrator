import { useMemo, useSyncExternalStore } from 'react'

export const RECENT_MODELS_STORAGE_KEY = 'oc-orchestrator:recent-models'
const RECENT_MODELS_CHANGED_EVENT = 'oc-orchestrator:recent-models-changed'
let fallbackSnapshot = '[]'
let pendingSnapshot: string | null = null

function getSnapshot(): string {
  if (pendingSnapshot !== null) return pendingSnapshot
  try {
    return localStorage.getItem(RECENT_MODELS_STORAGE_KEY) ?? '[]'
  } catch {
    return fallbackSnapshot
  }
}

function parseModels(snapshot: string): string[] {
  try {
    const values: unknown = JSON.parse(snapshot)
    if (!Array.isArray(values)) return []
    return [...new Set(values.filter((value): value is string =>
      typeof value === 'string' && value.trim().length > 0 && value !== 'auto'
    ))].slice(0, 3)
  } catch {
    return []
  }
}

export function recordRecentModel(model: string): void {
  if (!model.trim() || model === 'auto') return
  const models = [model, ...parseModels(getSnapshot()).filter((value) => value !== model)].slice(0, 3)
  fallbackSnapshot = JSON.stringify(models)
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
  return useMemo(() => parseModels(snapshot), [snapshot])
}

export function prioritizeRecentOptions<T extends { value: string }>(
  options: readonly T[],
  recentModels: readonly string[],
  search: string
): readonly T[] {
  if (search.trim()) return options
  const recentOptions = recentModels.flatMap((value) => {
    const option = options.find((option) => option.value === value)
    return option ? [option] : []
  })
  const recentValues = new Set(recentOptions.map((option) => option.value))
  return [...recentOptions, ...options.filter((option) => !recentValues.has(option.value))]
}
