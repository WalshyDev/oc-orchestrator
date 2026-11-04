import { useCallback, useState } from 'react'

export function useMostRecentExpansion(enabled: boolean, latestId: string | undefined, latestRevision = latestId) {
  if (!enabled) {
    latestId = undefined
    latestRevision = undefined
  }
  const [selection, setSelection] = useState({ enabled, latestId, latestRevision, expandedId: latestId })
  const current = selection.enabled === enabled && selection.latestId === latestId && selection.latestRevision === latestRevision
  const expandedId = current ? selection.expandedId : latestId

  if (!current) setSelection({ enabled, latestId, latestRevision, expandedId: latestId })

  const toggle = useCallback((id: string) => {
    setSelection((previous) => ({
      ...previous,
      expandedId: previous.expandedId === id ? undefined : id
    }))
  }, [])

  return { expandedId, toggle }
}
