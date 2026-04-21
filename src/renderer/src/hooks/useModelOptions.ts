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
    models: Record<string, {
      id: string
      name: string
      limit?: { context?: number; input?: number; output?: number }
    }>
  }>
}

/**
 * Global cache mapping `${providerId}/${modelId}` and bare `modelId` to the
 * provider-reported context window. Populated from the provider fetch and
 * queried by callers that need to compute "% of context used" for an agent.
 */
const contextLimitCache = new Map<string, number>()

/** Observers notified when new context limits are recorded — typically the
 *  agent store, which backfills limits onto agents whose modelID was hydrated
 *  before the provider fetch completed. */
const contextLimitObservers = new Set<() => void>()

export function subscribeToContextLimits(listener: () => void): () => void {
  contextLimitObservers.add(listener)
  // Fire immediately if the cache is already populated. Without this, a
  // listener that mounts after the initial provider fetch (e.g. React strict
  // mode's double-mount, HMR reloads, or any code path where the fetch
  // finishes before the agent store's useEffect runs) would never backfill
  // limits on its agents.
  if (contextLimitCache.size > 0) listener()
  return () => contextLimitObservers.delete(listener)
}

export function recordContextLimitsFromProviders(data: ProviderData): void {
  let changed = false
  for (const provider of data.providers) {
    for (const model of Object.values(provider.models)) {
      const limit = model.limit?.context
      if (typeof limit !== 'number' || limit <= 0) continue
      const key = `${provider.id}/${model.id}`
      if (contextLimitCache.get(key) !== limit) {
        contextLimitCache.set(key, limit)
        changed = true
      }
      // Also index by bare id so callers that don't carry the provider prefix
      // can still look up a limit when it's unambiguous.
      if (!contextLimitCache.has(model.id)) {
        contextLimitCache.set(model.id, limit)
        changed = true
      }
    }
  }
  if (changed) {
    for (const listener of contextLimitObservers) listener()
  }
}

export function lookupContextLimit(modelKey: string | undefined): number | undefined {
  if (!modelKey) return undefined
  return contextLimitCache.get(modelKey)
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
/**
 * Fetch providers + system config once and cache the results so repeated
 * callers (useModelOptions across multiple modals, the agent store's boot
 * backfill) share a single network call. The first call triggers the fetch;
 * subsequent calls during the same in-flight request await the same promise.
 */
interface ProviderFetchResult {
  providerData: ProviderData | null
  configModel: string | undefined
}

let providerFetchPromise: Promise<ProviderFetchResult> | null = null

export function ensureProvidersLoaded(): Promise<ProviderFetchResult> {
  if (providerFetchPromise) return providerFetchPromise

  providerFetchPromise = (async () => {
    try {
      const [providersResult, configResult] = await Promise.all([
        window.api.listAllProviders(),
        window.api.getSystemConfig(),
      ])

      const providerData = providersResult.ok && providersResult.data
        ? providersResult.data as ProviderData
        : null

      if (providerData) recordContextLimitsFromProviders(providerData)

      const configModel = configResult.ok && configResult.data
        ? (configResult.data as { model?: string }).model
        : undefined

      return { providerData, configModel }
    } catch (err) {
      console.warn('[ensureProvidersLoaded] fetch failed', err)
      // Reset so a later caller can retry. Without this, a transient failure
      // would permanently disable provider-dependent features.
      providerFetchPromise = null
      return { providerData: null, configModel: undefined }
    }
  })()

  return providerFetchPromise
}

export function useModelOptions(): { options: ModelOption[]; loading: boolean } {
  const [options, setOptions] = useState<ModelOption[]>(STATIC_MODEL_OPTIONS)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    void ensureProvidersLoaded().then(({ providerData, configModel }) => {
      if (cancelled) return

      let opts: ModelOption[]
      if (providerData) {
        const dynamicOptions = buildOptionsFromProviders(providerData)
        opts = dynamicOptions.length > 1 ? dynamicOptions : [...STATIC_MODEL_OPTIONS]
      } else {
        opts = [...STATIC_MODEL_OPTIONS]
      }

      opts[0] = { value: 'auto', label: resolveSystemDefaultLabel(configModel, providerData) }
      setOptions(opts)
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [])

  return { options, loading }
}
