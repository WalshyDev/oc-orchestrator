import { useState, useEffect } from 'react'
import { formatModelName } from './useAgentStore'

export interface ModelOption {
  value: string
  label: string
}

export interface ModelVariantOption {
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
      variants?: Record<string, Record<string, unknown>>
    }>
  }>
}

export function formatVariantLabel(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1)
}

export function getVariantOptionsForModel(
  modelValue: string,
  providers: ProviderData | null,
  configModel: string | undefined
): ModelVariantOption[] {
  const options: ModelVariantOption[] = [{ value: 'auto', label: 'Provider Default' }]
  if (!providers) return options

  const resolvedModel = modelValue === 'auto' ? configModel : modelValue
  if (!resolvedModel) return options

  const slashIndex = resolvedModel.indexOf('/')
  const providerId = slashIndex > 0 ? resolvedModel.slice(0, slashIndex) : undefined
  const modelId = slashIndex > 0 ? resolvedModel.slice(slashIndex + 1) : resolvedModel

  for (const provider of providers.providers) {
    if (providerId && provider.id !== providerId) continue

    for (const model of Object.values(provider.models)) {
      if (model.id !== modelId && model.id !== resolvedModel) continue

      const variantKeys = model.variants ? Object.keys(model.variants) : []
      return [
        ...options,
        ...variantKeys.map((variantKey) => ({
          value: variantKey,
          label: formatVariantLabel(variantKey),
        })),
      ]
    }
  }

  return options
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

// Provider data is cached because it is relatively stable and feeds global
// context-limit backfills. Config is fetched fresh so System Default does not
// stay pinned to the model resolved when the app first started.
interface ProviderFetchResult {
  providerData: ProviderData | null
  configModel: string | undefined
}

let providerFetchPromise: Promise<ProviderData | null> | null = null

const configChangeObservers = new Set<() => void>()

export function subscribeToConfigChanges(listener: () => void): () => void {
  configChangeObservers.add(listener)
  return () => configChangeObservers.delete(listener)
}

export function invalidateProviderCache(): void {
  providerFetchPromise = null
  resetProviderRetry()
  for (const listener of configChangeObservers) listener()
}

// Automatic retry for the common race where ensureProvidersLoaded runs before
// any runtime exists. We back off exponentially but cap at 5 seconds so we
// settle quickly once a runtime spins up, without hammering on a truly-empty
// install. Max ~25s of total retries — after that we stop until something
// explicit (like a new agent launch) triggers another fetch.
let retryDelayMs = 500
let retryTimer: ReturnType<typeof setTimeout> | null = null

function scheduleProviderRetry(): void {
  if (retryTimer) return // already scheduled
  if (retryDelayMs > 5000) return // gave up; wait for explicit trigger
  retryTimer = setTimeout(() => {
    retryTimer = null
    retryDelayMs = Math.min(retryDelayMs * 2, 5000)
    void ensureProvidersLoaded()
  }, retryDelayMs)
}

function resetProviderRetry(): void {
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
  retryDelayMs = 500
}

function fetchProviderData(): Promise<ProviderData | null> {
  if (providerFetchPromise) return providerFetchPromise

  providerFetchPromise = (async () => {
    try {
      const providersResult = await window.api.listAllProviders()

      const providerData = providersResult.ok && providersResult.data
        ? providersResult.data as ProviderData
        : null

      if (providerData) {
        resetProviderRetry()
        recordContextLimitsFromProviders(providerData)
      } else {
        // Common cause: the fetch raced with agent restoration, so no runtime
        // was attached yet and the main process returned ok:true with no data.
        // Clear the cached promise so a future caller can retry, and schedule
        // an automatic retry after a short delay so context limits populate
        // even if nothing else triggers a re-fetch.
        providerFetchPromise = null
        scheduleProviderRetry()
      }

      return providerData
    } catch (err) {
      console.warn('[ensureProvidersLoaded] fetch failed', err)
      // Reset so a later caller can retry. Without this, a transient failure
      // would permanently disable provider-dependent features.
      providerFetchPromise = null
      return null
    }
  })()

  return providerFetchPromise
}

async function fetchConfigModel(): Promise<string | undefined> {
  try {
    const configResult = await window.api.getSystemConfig()
    return configResult.ok && configResult.data
      ? (configResult.data as { model?: string }).model
      : undefined
  } catch (err) {
    console.warn('[ensureProvidersLoaded] config fetch failed', err)
    return undefined
  }
}

export async function ensureProvidersLoaded(): Promise<ProviderFetchResult> {
  const [providerData, configModel] = await Promise.all([
    fetchProviderData(),
    fetchConfigModel(),
  ])

  return { providerData, configModel }
}

export function useModelOptions(): { options: ModelOption[]; loading: boolean; providerData: ProviderData | null; configModel: string | undefined } {
  const [options, setOptions] = useState<ModelOption[]>(STATIC_MODEL_OPTIONS)
  const [providerData, setProviderData] = useState<ProviderData | null>(null)
  const [configModel, setConfigModel] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    let requestSeq = 0

    const load = (): void => {
      const seq = ++requestSeq
      void ensureProvidersLoaded().then(({ providerData, configModel }) => {
        if (cancelled || seq !== requestSeq) return

        let opts: ModelOption[]
        if (providerData) {
          const dynamicOptions = buildOptionsFromProviders(providerData)
          opts = dynamicOptions.length > 1 ? dynamicOptions : [...STATIC_MODEL_OPTIONS]
        } else {
          opts = [...STATIC_MODEL_OPTIONS]
        }

        opts[0] = { value: 'auto', label: resolveSystemDefaultLabel(configModel, providerData) }
        setOptions(opts)
        setProviderData(providerData)
        setConfigModel(configModel)
        setLoading(false)
      })
    }

    load()
    // Re-fetch when the cache is invalidated (e.g. a runtime restarts after a
    // config change) so the System Default label reflects the current config.
    const unsubscribe = subscribeToConfigChanges(load)

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return { options, loading, providerData, configModel }
}
