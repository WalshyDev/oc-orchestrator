import { useCallback, useState } from 'react'

export function useMostRecentExpansion(enabled: boolean, latestId: string | undefined, latestRevision = latestId) {
  if (!enabled) {
    latestId = undefined
    latestRevision = undefined
  }
  const [selection, setSelection] = useState({
    enabled, latestId, latestRevision, expandedId: latestId, manuallyExpandedIds: new Set<string>()
  })
  const current = selection.enabled === enabled && selection.latestId === latestId && selection.latestRevision === latestRevision
  const activeSelection = current ? selection : {
    enabled, latestId, latestRevision, expandedId: latestId,
    manuallyExpandedIds: selection.enabled === enabled ? selection.manuallyExpandedIds : new Set<string>()
  }

  if (!current) setSelection(activeSelection)

  const toggle = useCallback((id: string) => {
    setSelection((previous) => {
      const manuallyExpandedIds = new Set(previous.manuallyExpandedIds)
      if (previous.expandedId === id || manuallyExpandedIds.has(id)) manuallyExpandedIds.delete(id)
      else manuallyExpandedIds.add(id)
      return {
        ...previous,
        expandedId: previous.expandedId === id ? undefined : previous.expandedId,
        manuallyExpandedIds
      }
    })
  }, [])

  const expand = useCallback((id: string) => {
    setSelection((previous) => ({
      ...previous,
      manuallyExpandedIds: new Set(previous.manuallyExpandedIds).add(id)
    }))
  }, [])

  return {
    isExpanded: (id: string) => activeSelection.expandedId === id || activeSelection.manuallyExpandedIds.has(id),
    toggle,
    expand
  }
}
