import { useState, useEffect } from 'react'
import { X, Check, CircleNotch, MagnifyingGlass } from '@phosphor-icons/react'

interface ProviderModel {
  id: string
  name: string
  providerID: string
}

interface ProviderGroup {
  id: string
  name: string
  models: ProviderModel[]
}

interface ModelPickerModalProps {
  agentId: string
  currentModel?: string
  onClose: () => void
  onSelect: (modelPath: string) => void
}

export function ModelPickerModal({ agentId, currentModel, onClose, onSelect }: ModelPickerModalProps) {
  const [providers, setProviders] = useState<ProviderGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selecting, setSelecting] = useState<string | null>(null)

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
              models: Record<string, { id: string; name: string; providerID: string }>
            }>
          }

          const groups: ProviderGroup[] = data.providers
            .map((provider) => ({
              id: provider.id,
              name: provider.name,
              models: Object.values(provider.models).map((model) => ({
                id: model.id,
                name: model.name,
                providerID: model.providerID
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

  const handleSelect = async (providerID: string, modelID: string): Promise<void> => {
    const modelPath = `${providerID}/${modelID}`
    setSelecting(modelPath)
    onSelect(modelPath)
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
                    const isSelecting = selecting === modelPath

                    return (
                      <button
                        key={model.id}
                        onClick={() => void handleSelect(provider.id, model.id)}
                        disabled={isSelecting}
                        className={`flex items-center justify-between px-3 py-2 rounded-md text-left text-sm transition-colors ${
                          isCurrent
                            ? 'bg-kumo-brand/10 border border-kumo-brand/25 text-kumo-strong'
                            : 'hover:bg-kumo-fill text-kumo-default'
                        }`}
                      >
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <span className="font-medium truncate">{model.name}</span>
                          <span className="font-mono text-[10px] text-kumo-subtle truncate">{model.id}</span>
                        </div>
                        {isCurrent && <Check size={14} className="text-kumo-brand shrink-0 ml-2" />}
                        {isSelecting && <CircleNotch size={14} className="animate-spin text-kumo-brand shrink-0 ml-2" />}
                      </button>
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
