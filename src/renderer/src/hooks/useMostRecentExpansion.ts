import { useCallback, useState } from 'react'

export function useMostRecentExpansion(enabled: boolean, latestId: string | undefined) {
  if (!enabled) latestId = undefined
  const [selection, setSelection] = useState({ enabled, latestId, expandedId: latestId })
  const current = selection.enabled === enabled && selection.latestId === latestId
  const expandedId = current ? selection.expandedId : latestId

  if (!current) setSelection({ enabled, latestId, expandedId: latestId })

  const toggle = useCallback((id: string) => {
    setSelection((previous) => ({
      ...previous,
      expandedId: previous.expandedId === id ? undefined : id
    }))
  }, [])

  return { expandedId, toggle }
}
