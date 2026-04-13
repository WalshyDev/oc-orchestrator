import { useState } from 'react'
import {
  CaretDown,
  CheckCircle,
  Eye,
  Warning,
  PencilSimpleLine,
  XCircle,
  Tag,
  Plus,
  X
} from '@phosphor-icons/react'
import { agentLabelDisplay, getLabelDefinition, LABEL_COLORS, type LabelDefinition, type LabelColorKey } from '../types'
import { useDismiss } from '../hooks/useDismiss'

const BUILTIN_ICONS: Record<string, React.ReactNode> = {
  draft: <PencilSimpleLine size={12} />,
  in_review: <Eye size={12} />,
  blocked: <Warning size={12} />,
  done: <CheckCircle size={12} />
}

const COLOR_KEYS: LabelColorKey[] = [
  'red', 'orange', 'amber', 'green', 'teal',
  'blue', 'indigo', 'purple', 'pink', 'gray'
]

interface LabelDropdownProps {
  current: string | null
  onSelect: (labelId: string | null) => void
  allLabels: LabelDefinition[]
  onCreateLabel?: (name: string, colorKey: LabelColorKey) => Promise<LabelDefinition | null>
  onDeleteLabel?: (id: string) => Promise<boolean>
  variant?: 'row' | 'action' | 'inline'
}

export function LabelDropdown({ current, onSelect, allLabels, onCreateLabel, onDeleteLabel, variant = 'row' }: LabelDropdownProps) {
  const { open, toggle, close, containerRef } = useDismiss()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState<LabelColorKey>('blue')

  const selectAndClose = (value: string | null) => {
    onSelect(value)
    setCreating(false)
    close()
  }

  const handleToggle = (event: React.MouseEvent) => {
    event.stopPropagation()
    toggle()
    if (open) setCreating(false)
  }

  const handleCreate = async () => {
    if (!onCreateLabel || !newName.trim()) return
    const label = await onCreateLabel(newName.trim(), newColor)
    if (label) {
      onSelect(label.id)
      setNewName('')
      setNewColor('blue')
      setCreating(false)
      close()
    }
  }

  const handleDelete = async (event: React.MouseEvent, labelId: string) => {
    event.stopPropagation()
    if (!onDeleteLabel) return
    const deleted = await onDeleteLabel(labelId)
    if (deleted && current === labelId) {
      onSelect(null)
    }
  }

  const currentLabel = agentLabelDisplay(current, allLabels)
  const currentDef = getLabelDefinition(current, allLabels)
  const currentColors = currentDef ? LABEL_COLORS[currentDef.colorKey] : null

  let menuPosition: string
  let trigger: React.ReactNode

  switch (variant) {
    case 'action':
      menuPosition = 'absolute bottom-full left-0 mb-1'
      trigger = (
        <button
          onClick={handleToggle}
          className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-md border bg-kumo-control border-kumo-line text-kumo-default hover:bg-kumo-fill transition-colors"
        >
          {(current && BUILTIN_ICONS[current]) ?? <Tag size={12} />}
          {currentLabel}
          <CaretDown size={10} className="ml-0.5" />
        </button>
      )
      break

    case 'inline':
      menuPosition = 'absolute top-full left-0 mt-1'
      trigger = current ? (
        <button
          onClick={handleToggle}
          className={`inline-flex items-center px-1.5 py-px rounded text-[10px] font-medium transition-colors cursor-pointer ${
            currentColors
              ? `${currentColors.bg} ${currentColors.text}`
              : 'bg-kumo-brand/10 text-kumo-brand'
          }`}
          title="Change label"
        >
          {currentLabel}
        </button>
      ) : (
        <button
          onClick={handleToggle}
          className="inline-flex items-center gap-0.5 px-1 py-px rounded text-[10px] text-kumo-subtle hover:text-kumo-default hover:bg-kumo-fill transition-colors cursor-pointer opacity-0 group-hover:opacity-100"
          title="Add label"
        >
          <Tag size={10} />
        </button>
      )
      break

    default:
      menuPosition = 'absolute top-full right-0 mt-1'
      trigger = (
        <button
          onClick={handleToggle}
          className="w-6 h-6 flex items-center justify-center bg-kumo-fill border border-kumo-line rounded text-kumo-subtle hover:bg-kumo-fill-hover hover:text-kumo-default transition-colors cursor-pointer"
          title={`Label: ${currentLabel}`}
        >
          <CaretDown size={10} />
        </button>
      )
      break
  }

  return (
    <div ref={containerRef} className="relative inline-flex">
      {trigger}
      {open && (
        <div className={`${menuPosition} z-[100] min-w-[160px] rounded-lg border border-kumo-line bg-kumo-elevated p-1 shadow-xl`}>
          {/* None option */}
          <button
            onClick={(event) => { event.stopPropagation(); selectAndClose(null) }}
            className={`flex items-center gap-2 w-full px-2.5 py-1.5 text-[11px] rounded transition-colors text-left ${
              current === null
                ? 'bg-kumo-interact/12 text-kumo-link'
                : 'text-kumo-default hover:bg-kumo-fill'
            }`}
          >
            <XCircle size={12} />
            None
          </button>

          {/* All labels (built-in + custom) */}
          {allLabels.map((label) => {
            const colors = LABEL_COLORS[label.colorKey]
            const isSelected = label.id === current
            const isCustom = !label.builtIn
            return (
              <div key={label.id} className="group/label flex items-center">
                <button
                  onClick={(event) => { event.stopPropagation(); selectAndClose(label.id) }}
                  className={`flex items-center gap-2 flex-1 min-w-0 px-2.5 py-1.5 text-[11px] rounded transition-colors text-left ${
                    isSelected
                      ? 'bg-kumo-interact/12 text-kumo-link'
                      : 'text-kumo-default hover:bg-kumo-fill'
                  }`}
                >
                  {BUILTIN_ICONS[label.id] ?? (
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${colors.swatch}`} />
                  )}
                  <span className="truncate">{label.name}</span>
                </button>
                {isCustom && onDeleteLabel && (
                  <button
                    onClick={(event) => void handleDelete(event, label.id)}
                    className="shrink-0 p-1 mr-1 rounded text-kumo-subtle hover:text-kumo-danger hover:bg-kumo-danger/10 transition-colors opacity-0 group-hover/label:opacity-100"
                    title={`Delete ${label.name}`}
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            )
          })}

          {/* Create new label */}
          {onCreateLabel && (
            <>
              <div className="border-t border-kumo-line my-1" />
              {creating ? (
                <div className="px-2 py-1.5 space-y-1.5" onClick={(e) => e.stopPropagation()}>
                  <input
                    autoFocus
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate(); if (e.key === 'Escape') setCreating(false) }}
                    placeholder="Label name..."
                    className="w-full bg-kumo-control border border-kumo-line rounded px-2 py-1 text-[11px] text-kumo-default placeholder:text-kumo-subtle outline-none focus:border-kumo-brand/50"
                    maxLength={30}
                  />
                  <div className="flex gap-1 flex-wrap">
                    {COLOR_KEYS.map((key) => {
                      const c = LABEL_COLORS[key]
                      const selected = key === newColor
                      return (
                        <button
                          key={key}
                          onClick={() => setNewColor(key)}
                          className={`w-4 h-4 rounded-full ${c.swatch} ${selected ? 'ring-2 ring-offset-1 ring-offset-kumo-elevated ring-white/50' : ''}`}
                          title={key}
                        />
                      )
                    })}
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => void handleCreate()}
                      disabled={!newName.trim()}
                      className="flex-1 px-2 py-1 text-[10px] font-medium rounded bg-kumo-brand text-white hover:bg-kumo-brand/90 disabled:opacity-40 transition-colors"
                    >
                      Create
                    </button>
                    <button
                      onClick={() => setCreating(false)}
                      className="px-2 py-1 text-[10px] rounded text-kumo-subtle hover:text-kumo-default hover:bg-kumo-fill transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={(event) => { event.stopPropagation(); setCreating(true) }}
                  className="flex items-center gap-2 w-full px-2.5 py-1.5 text-[11px] rounded transition-colors text-left text-kumo-subtle hover:text-kumo-default hover:bg-kumo-fill"
                >
                  <Plus size={12} />
                  New label...
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
