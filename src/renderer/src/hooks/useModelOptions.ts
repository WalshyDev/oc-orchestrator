import { useState, useEffect } from 'react'
import { formatModelName } from './useAgentStore'

export interface ModelOption {
  value: string
  label: string
}

export interface ProviderData {
  providers: Array<{
    id: string
    name: string
    models: Record<string, { id: string; name: string }>
  }>
}

export const STATIC_MODEL_OPTIONS: ModelOption[] = [
  { value: 'auto', label: 'System Default' },
  { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
  { value: 'claude-opus-4-20250515', label: 'Claude Opus 4' },
  { value: 'claude-haiku-3-20240307', label: 'Claude Haiku 3' },
]

export function buildOptionsFromProviders(data: ProviderData): ModelOption[] {
  const options: ModelOption[] = [{ value: 'auto', label: 'System Default' }]

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
 * Resolves the system default model name from the config and provider data,
 * returning a label like "System Default (sonnet-4)" or just "System Default".
 */
export function resolveSystemDefaultLabel(
  configModel: string | undefined,
  providers: ProviderData | null
): string {
  if (!configModel) return 'System Default'

  // Try to find a friendly name from provider data first
  if (providers) {
    const [providerId, modelId] = configModel.includes('/')
      ? configModel.split('/', 2)
      : [null, configModel]

    for (const provider of providers.providers) {
      if (providerId && provider.id !== providerId) continue
      for (const model of Object.values(provider.models)) {
        if (model.id === modelId || model.id === configModel) {
          return `System Default (${model.name})`
        }
      }
    }
  }

  // Fall back to formatModelName for a shorter display
  const shortName = formatModelName(configModel)
  return `System Default (${shortName})`
}

/**
 * Fetches model options dynamically from any active runtime.
 * Falls back to a static list if no runtimes are available.
 * Resolves the system default model name from the opencode config.
 */
export function useModelOptions(): { options: ModelOption[]; loading: boolean } {
  const [options, setOptions] = useState<ModelOption[]>(STATIC_MODEL_OPTIONS)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const fetchData = async (): Promise<void> => {
      try {
        const [providersResult, configResult] = await Promise.all([
          window.api.listAllProviders(),
          window.api.getSystemConfig(),
        ])
        if (cancelled) return

        const providerData = providersResult.ok && providersResult.data
          ? providersResult.data as ProviderData
          : null

        const configModel = configResult.ok && configResult.data
          ? (configResult.data as { model?: string }).model
          : undefined

        let opts: ModelOption[]
        if (providerData) {
          const dynamicOptions = buildOptionsFromProviders(providerData)
          opts = dynamicOptions.length > 1 ? dynamicOptions : [...STATIC_MODEL_OPTIONS]
        } else {
          opts = [...STATIC_MODEL_OPTIONS]
        }

        // Resolve the system default label
        const defaultLabel = resolveSystemDefaultLabel(configModel, providerData)
        opts[0] = { value: 'auto', label: defaultLabel }

        setOptions(opts)
      } catch {
        // Fall back to static list silently
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void fetchData()
    return () => { cancelled = true }
  }, [])

  return { options, loading }
}
