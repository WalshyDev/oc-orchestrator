import { useState, useEffect } from 'react'

export interface ModelOption {
  value: string
  label: string
}

const STATIC_MODEL_OPTIONS: ModelOption[] = [
  { value: 'auto', label: 'Auto (recommended)' },
  { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
  { value: 'claude-opus-4-20250515', label: 'Claude Opus 4' },
  { value: 'claude-haiku-3-20240307', label: 'Claude Haiku 3' },
]

interface ProviderData {
  providers: Array<{
    id: string
    name: string
    models: Record<string, { id: string; name: string }>
  }>
}

function buildOptionsFromProviders(data: ProviderData): ModelOption[] {
  const options: ModelOption[] = [{ value: 'auto', label: 'Auto (recommended)' }]

  const providers = [...data.providers]
    .filter((p) => Object.keys(p.models).length > 0)
    .sort((a, b) => a.name.localeCompare(b.name))

  for (const provider of providers) {
    for (const model of Object.values(provider.models)) {
      options.push({
        value: `${provider.id}/${model.id}`,
        label: `${model.name}  (${provider.name})`,
      })
    }
  }

  return options
}

/**
 * Fetches model options dynamically from any active runtime.
 * Falls back to a static list if no runtimes are available.
 */
export function useModelOptions(): { options: ModelOption[]; loading: boolean } {
  const [options, setOptions] = useState<ModelOption[]>(STATIC_MODEL_OPTIONS)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const fetchProviders = async (): Promise<void> => {
      try {
        const result = await window.api.listAllProviders()
        if (cancelled) return

        if (result.ok && result.data) {
          const dynamicOptions = buildOptionsFromProviders(result.data as ProviderData)
          if (dynamicOptions.length > 1) {
            setOptions(dynamicOptions)
          }
        }
      } catch {
        // Fall back to static list silently
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void fetchProviders()
    return () => { cancelled = true }
  }, [])

  return { options, loading }
}
