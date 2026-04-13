import { useState, useEffect, useCallback, useMemo } from 'react'
import { BUILTIN_LABELS, BUILTIN_LABEL_IDS, type LabelDefinition, type LabelColorKey } from '../types'

const RESERVED_IDS = new Set([
  ...BUILTIN_LABEL_IDS,
  'running', 'idle', 'completed', 'errored', 'starting',
  'stopping', 'disconnected', 'needs_input', 'needs_approval',
  'completed_manual', 'blocked_manual'
])

function generateLabelId(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40)
  if (!base) return `label_${Date.now()}`
  if (RESERVED_IDS.has(base)) return `custom_${base}`
  return base
}

export function useCustomLabels() {
  const [customLabels, setCustomLabels] = useState<LabelDefinition[]>([])

  useEffect(() => {
    if (!window.api?.listCustomLabels) return
    void window.api.listCustomLabels().then((result) => {
      if (result.ok && Array.isArray(result.data)) {
        setCustomLabels(result.data.map((row) => ({
          id: row.id,
          name: row.name,
          colorKey: row.color_key as LabelColorKey,
          builtIn: false
        })))
      }
    })
  }, [])

  const allLabels = useMemo<LabelDefinition[]>(
    () => [...BUILTIN_LABELS, ...customLabels],
    [customLabels]
  )

  const createLabel = useCallback(async (name: string, colorKey: LabelColorKey): Promise<LabelDefinition | null> => {
    if (!window.api?.createCustomLabel) return null
    const trimmed = name.trim()
    if (!trimmed) return null

    const existing = customLabels.find((l) => l.name.toLowerCase() === trimmed.toLowerCase())
    if (existing) return existing

    let id = generateLabelId(trimmed)
    const existingIds = new Set(customLabels.map((l) => l.id))
    while (existingIds.has(id)) {
      id = `${id}_${Date.now()}`
    }

    const result = await window.api.createCustomLabel({ id, name: trimmed, colorKey })
    if (!result.ok || !result.data) return null

    const newLabel: LabelDefinition = { id, name: trimmed, colorKey, builtIn: false }
    setCustomLabels((prev) => [...prev, newLabel])
    return newLabel
  }, [customLabels])

  const updateLabel = useCallback(async (id: string, name: string, colorKey: LabelColorKey): Promise<boolean> => {
    if (!window.api?.updateCustomLabel) return false
    const trimmed = name.trim()
    if (!trimmed) return false

    const result = await window.api.updateCustomLabel({ id, name: trimmed, colorKey })
    if (!result.ok) return false

    setCustomLabels((prev) => prev.map((l) =>
      l.id === id ? { ...l, name: trimmed, colorKey } : l
    ))
    return true
  }, [])

  const deleteLabel = useCallback(async (id: string): Promise<boolean> => {
    if (!window.api?.deleteCustomLabel) return false
    const result = await window.api.deleteCustomLabel(id)
    if (!result.ok) return false

    setCustomLabels((prev) => prev.filter((l) => l.id !== id))
    return true
  }, [])

  return {
    customLabels,
    allLabels,
    createLabel,
    updateLabel,
    deleteLabel
  }
}
