import { useState, useEffect } from 'react'
import { X, Check, CircleNotch, MagnifyingGlass, CaretDown, CaretRight } from '@phosphor-icons/react'

interface ProviderModel {
  id: string
  name: string
  providerID: string
  variants?: Record<string, Record<string, unknown>>
}

interface ProviderGroup {
  id: string
  name: string
  models: ProviderModel[]
}

interface ModelPickerModalProps {
  agentId: string
  currentModel?: string
  currentVariant?: string
  onClose: () => void
  onSelect: (modelPath: string, variant?: string) => void
}

function formatVariantLabel(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1)
}

export function ModelPickerModal({ agentId, currentModel, currentVariant, onClose, onSelect }: ModelPickerModalProps) {
  const [providers, setProviders] = useState<ProviderGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selecting, setSelecting] = useState<string | null>(null)
  const [expandedModel, setExpandedModel] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const fetchProviders = async (): Promise<void> => {
      try {
        const result = await window.api.getProviders(agentId)
        if (cancelled) return

        if (result.ok && result.data) {
          const data = result.data as {
            providers: Array<{
              id: string
              name: string
              models: Record<string, {
                id: string
                name: string
                providerID: string
                variants?: Record<string, Record<string, unknown>>
              }>
            }>
          }

          const groups: ProviderGroup[] = data.providers
            .map((provider) => ({
              id: provider.id,
              name: provider.name,
              models: Object.values(provider.models).map((model) => ({
                id: model.id,
                name: model.name,
                providerID: model.providerID,
                variants: model.variants
              }))
            }))
            .filter((group) => group.models.length > 0)
            .sort((left, right) => left.name.localeCompare(right.name))

          setProviders(groups)
        }
      } catch (error) {
        console.error('Failed to fetch providers:', error)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void fetchProviders()
    return () => { cancelled = true }
  }, [agentId])

  const handleSelect = async (providerID: string, modelID: string, variant?: string): Promise<void> => {
    const modelPath = `${providerID}/${modelID}`
    const selectKey = variant ? `${modelPath}:${variant}` : modelPath
    setSelecting(selectKey)
    onSelect(modelPath, variant)
  }

  const handleModelClick = (providerID: string, modelID: string, variants?: Record<string, Record<string, unknown>>): void => {
    const modelPath = `${providerID}/${modelID}`
    const variantKeys = variants ? Object.keys(variants) : []

    if (variantKeys.length > 0) {
      // Toggle expansion for models with variants
      setExpandedModel(expandedModel === modelPath ? null : modelPath)
    } else {
      // No variants — select immediately
      void handleSelect(providerID, modelID)
    }
  }

  const query = search.toLowerCase()
  const filteredProviders = providers
    .map((provider) => ({
      ...provider,
      models: provider.models.filter((model) =>
        model.name.toLowerCase().includes(query) ||
        model.id.toLowerCase().includes(query) ||
        provider.name.toLowerCase().includes(query)
      )
    }))
    .filter((provider) => provider.models.length > 0)

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[480px] max-h-[70vh] bg-kumo-elevated border border-kumo-line rounded-xl shadow-2xl flex flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-kumo-line">
          <div>
            <h2 className="text-base font-semibold text-kumo-strong">Select Model</h2>
            {currentModel && (
              <p className="text-[11px] text-kumo-subtle mt-0.5">
                Current: <span className="font-mono text-kumo-default">{currentModel}</span>
                {currentVariant && (
                  <span className="text-kumo-default"> ({formatVariantLabel(currentVariant)})</span>
                )}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md border border-kumo-line text-kumo-subtle hover:text-kumo-default hover:bg-kumo-fill transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-kumo-line">
          <div className="relative">
            <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-kumo-subtle" />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search models..."
              autoFocus
              className="w-full pl-8 pr-3 py-2 bg-kumo-control border border-kumo-line rounded-md text-sm text-kumo-default outline-none focus:border-kumo-ring placeholder:text-kumo-subtle"
            />
          </div>
        </div>

        {/* Model List */}
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {loading ? (
            <div className="flex items-center justify-center py-8 gap-2 text-kumo-subtle text-sm">
              <CircleNotch size={16} className="animate-spin" />
              Loading providers...
            </div>
          ) : filteredProviders.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-kumo-subtle text-sm">
              {search ? 'No models match your search' : 'No providers available'}
            </div>
          ) : (
            filteredProviders.map((provider) => (
              <div key={provider.id} className="mb-3">
                <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-kumo-subtle">
                  {provider.name}
                </div>
                <div className="flex flex-col gap-0.5">
                  {provider.models.map((model) => {
                    const modelPath = `${provider.id}/${model.id}`
                    const isCurrent = currentModel === modelPath
                    const variantKeys = model.variants ? Object.keys(model.variants) : []
                    const hasVariants = variantKeys.length > 0
                    const isExpanded = expandedModel === modelPath

                    return (
                      <div key={model.id}>
                        <button
                          onClick={() => handleModelClick(provider.id, model.id, model.variants)}
                          disabled={selecting === modelPath}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-left text-sm transition-colors ${
                            isCurrent && !currentVariant
                              ? 'bg-kumo-brand/10 border border-kumo-brand/25 text-kumo-strong'
                              : isCurrent && currentVariant
                                ? 'bg-kumo-brand/5 text-kumo-strong'
                                : 'hover:bg-kumo-fill text-kumo-default'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {hasVariants && (
                              isExpanded
                                ? <CaretDown size={12} className="text-kumo-subtle shrink-0" />
                                : <CaretRight size={12} className="text-kumo-subtle shrink-0" />
                            )}
                            <div className="flex flex-col gap-0.5 min-w-0">
                              <span className="font-medium truncate">{model.name}</span>
                              <span className="font-mono text-[10px] text-kumo-subtle truncate">{model.id}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0 ml-2">
                            {hasVariants && !isExpanded && (
                              <span className="text-[10px] text-kumo-subtle">{variantKeys.length} variant{variantKeys.length > 1 ? 's' : ''}</span>
                            )}
                            {isCurrent && !currentVariant && <Check size={14} className="text-kumo-brand" />}
                            {selecting === modelPath && <CircleNotch size={14} className="animate-spin text-kumo-brand" />}
                          </div>
                        </button>

                        {/* Variant sub-items */}
                        {hasVariants && isExpanded && (
                          <div className="ml-5 mt-0.5 flex flex-col gap-0.5">
                            {/* Default (no variant) option */}
                            <button
                              onClick={() => void handleSelect(provider.id, model.id)}
                              disabled={selecting === modelPath}
                              className={`w-full flex items-center justify-between px-3 py-1.5 rounded-md text-left text-sm transition-colors ${
                                isCurrent && !currentVariant
                                  ? 'bg-kumo-brand/10 border border-kumo-brand/25 text-kumo-strong'
                                  : 'hover:bg-kumo-fill text-kumo-default'
                              }`}
                            >
                              <span className="text-[12px]">Default</span>
                              {isCurrent && !currentVariant && <Check size={12} className="text-kumo-brand shrink-0 ml-2" />}
                              {selecting === modelPath && <CircleNotch size={12} className="animate-spin text-kumo-brand shrink-0 ml-2" />}
                            </button>

                            {variantKeys.map((variantKey) => {
                              const selectKey = `${modelPath}:${variantKey}`
                              const isCurrentVariant = isCurrent && currentVariant === variantKey

                              return (
                                <button
                                  key={variantKey}
                                  onClick={() => void handleSelect(provider.id, model.id, variantKey)}
                                  disabled={selecting === selectKey}
                                  className={`w-full flex items-center justify-between px-3 py-1.5 rounded-md text-left text-sm transition-colors ${
                                    isCurrentVariant
                                      ? 'bg-kumo-brand/10 border border-kumo-brand/25 text-kumo-strong'
                                      : 'hover:bg-kumo-fill text-kumo-default'
                                  }`}
                                >
                                  <span className="text-[12px]">{formatVariantLabel(variantKey)}</span>
                                  {isCurrentVariant && <Check size={12} className="text-kumo-brand shrink-0 ml-2" />}
                                  {selecting === selectKey && <CircleNotch size={12} className="animate-spin text-kumo-brand shrink-0 ml-2" />}
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
