import { useEffect, useState } from 'react'
import { getEditorDisplayLabel, loadSettings, SETTINGS_CHANGED_EVENT } from '../data/settings'

/**
 * Reactive accessor for the user-facing label of the configured default editor
 * (e.g. "GoLand", "VS Code", "Custom"). Updates when settings change.
 */
export function useEditorLabel(): string {
  const [label, setLabel] = useState(() => getEditorDisplayLabel(loadSettings().editor))

  useEffect(() => {
    const onSettingsChanged = () => setLabel(getEditorDisplayLabel(loadSettings().editor))
    window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
  }, [])

  return label
}
