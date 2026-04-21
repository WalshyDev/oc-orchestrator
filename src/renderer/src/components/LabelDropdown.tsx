import { useEffect, useRef, useState } from 'react'
import {
  CaretDown,
  Check,
  CheckCircle,
  Eye,
  Warning,
  PencilSimpleLine,
  XCircle,
  Tag,
  Plus,
  X
} from '@phosphor-icons/react'
import { getLabelDefinition, LABEL_COLORS, type LabelDefinition, type LabelColorKey } from '../types'
import { PortaledMenu, type MenuPlacement } from './PortaledMenu'

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
  current: string[]
  onToggle: (labelId: string) => void
  onClear: () => void
  onReplace?: (oldLabelId: string, newLabelId: string) => void
  allLabels: LabelDefinition[]
  onCreateLabel?: (name: string, colorKey: LabelColorKey) => Promise<LabelDefinition | null>
  onDeleteLabel?: (id: string) => Promise<boolean>
  variant?: 'row' | 'action' | 'inline'
  onOpenChange?: (open: boolean) => void
  className?: string
}

export function LabelDropdown({ current, onToggle, onClear, onReplace, allLabels, onCreateLabel, onDeleteLabel, variant = 'row', onOpenChange, className: extraClass }: LabelDropdownProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLDivElement>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState<LabelColorKey>('blue')
  const [replacingLabelId, setReplacingLabelId] = useState<string | null>(null)

  useEffect(() => {
    onOpenChange?.(open)
  }, [open, onOpenChange])

  const close = () => setOpen(false)
  const toggle = () => setOpen((prev) => !prev)

  const currentSet = new Set(current)

  const handleOpen = (event: React.MouseEvent) => {
    event.stopPropagation()
    setReplacingLabelId(null)
    toggle()
    if (open) setCreating(false)
  }

  const handlePillClick = (event: React.MouseEvent, labelId: string) => {
    event.stopPropagation()
    if (open && replacingLabelId === labelId) {
      close()
      setReplacingLabelId(null)
    } else {
      setReplacingLabelId(labelId)
      setCreating(false)
      if (!open) toggle()
    }
  }

  const handleCreate = async () => {
    if (!onCreateLabel || !newName.trim()) return
    const label = await onCreateLabel(newName.trim(), newColor)
    if (label) {
      if (replacingLabelId && onReplace) {
        onReplace(replacingLabelId, label.id)
      } else {
        onToggle(label.id)
      }
      setNewName('')
      setNewColor('blue')
      setCreating(false)
      setReplacingLabelId(null)
      close()
    }
  }

  const handleDelete = async (event: React.MouseEvent, labelId: string) => {
    event.stopPropagation()
    if (!onDeleteLabel) return
    await onDeleteLabel(labelId)
  }

  const sortedCurrent = current
    .map((id) => getLabelDefinition(id, allLabels))
    .filter((def): def is LabelDefinition => def !== null)
    .sort((a, b) => a.name.localeCompare(b.name))

  let displayLabel: string
  if (sortedCurrent.length === 0) {
    displayLabel = 'Label'
  } else if (sortedCurrent.length === 1) {
    displayLabel = sortedCurrent[0].name
  } else {
    displayLabel = `${sortedCurrent.length} labels`
  }

  const isReplacing = replacingLabelId !== null
  const replacingDef = replacingLabelId ? getLabelDefinition(replacingLabelId, allLabels) : null

  // Map each visual variant to a menu placement relative to its trigger.
  // 'action' opens upward-left (it sits in the bottom action rail); the others
  // open downward from their respective sides.
  let placement: MenuPlacement
  let trigger: React.ReactNode

  switch (variant) {
    case 'action':
      placement = 'top-left'
      trigger = (
        <button
          onClick={handleOpen}
          className="flex items-center gap-1 w-full px-2.5 py-1.5 text-[11px] font-medium rounded-md border bg-kumo-control border-kumo-line text-kumo-default hover:bg-kumo-fill transition-colors"
        >
          {(current.length === 1 && BUILTIN_ICONS[current[0]]) || <Tag size={12} />}
          {displayLabel}
          <CaretDown size={10} className="ml-0.5" />
        </button>
      )
      break

    case 'inline':
      placement = 'bottom-left'
      trigger = (
        <div className="inline-flex items-center gap-0.5">
          {sortedCurrent.map((def) => {
            const colors = LABEL_COLORS[def.colorKey]
            const isBeingReplaced = open && replacingLabelId === def.id
            return (
              <span
                key={def.id}
                className={`inline-flex items-center px-1.5 py-px rounded text-[10px] font-medium cursor-pointer ${colors.bg} ${colors.text} ${isBeingReplaced ? 'ring-1 ring-white/40' : ''}`}
                title={def.name}
                onClick={(event) => handlePillClick(event, def.id)}
              >
                {def.name}
              </span>
            )
          })}
          <button
            onClick={handleOpen}
            className={`inline-flex items-center justify-center w-4 h-4 rounded text-kumo-subtle hover:text-kumo-default hover:bg-kumo-fill transition-colors cursor-pointer ${current.length === 0 ? 'opacity-0 group-hover:opacity-100' : 'opacity-0 group-hover:opacity-70'}`}
            title="Add label"
          >
            <Plus size={10} />
          </button>
        </div>
      )
      break

    default:
      placement = 'bottom-right'
      trigger = (
        <button
          onClick={handleOpen}
          className="w-6 h-6 flex items-center justify-center bg-kumo-fill border border-kumo-line rounded text-kumo-subtle hover:bg-kumo-fill-hover hover:text-kumo-default transition-colors cursor-pointer"
          title={`Labels: ${displayLabel}`}
        >
          <CaretDown size={10} />
        </button>
      )
      break
  }

  const renderMenu = () => {
    if (isReplacing && replacingDef) {
      // Replace mode: pick a replacement for the clicked label, or remove it
      const otherLabels = allLabels.filter((l) => l.id !== replacingLabelId)
      return (
        <div className="min-w-[160px] rounded-lg border border-kumo-line bg-kumo-elevated p-1 shadow-xl">
          <div className="px-2.5 py-1 text-[10px] text-kumo-subtle font-medium">
            Replace {replacingDef.name}
          </div>

          <button
            onClick={(event) => { event.stopPropagation(); onToggle(replacingLabelId); setReplacingLabelId(null); close() }}
            className="flex items-center gap-2 w-full px-2.5 py-1.5 text-[11px] rounded transition-colors text-left text-kumo-default hover:bg-kumo-fill"
          >
            <XCircle size={12} />
            Remove
          </button>

          <div className="border-t border-kumo-line my-1" />

          {otherLabels.map((label) => {
            const colors = LABEL_COLORS[label.colorKey]
            const alreadyApplied = currentSet.has(label.id)
            const isCustom = !label.builtIn
            return (
              <div key={label.id} className="group/label flex items-center">
                <button
                  onClick={(event) => {
                    event.stopPropagation()
                    if (onReplace) {
                      onReplace(replacingLabelId, label.id)
                    } else {
                      onToggle(replacingLabelId)
                      onToggle(label.id)
                    }
                    setReplacingLabelId(null)
                    close()
                  }}
                  disabled={alreadyApplied}
                  className={`flex items-center gap-2 flex-1 min-w-0 px-2.5 py-1.5 text-[11px] rounded transition-colors text-left ${
                    alreadyApplied
                      ? 'text-kumo-subtle opacity-50 cursor-not-allowed'
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
      )
    }

    // Normal multi-select mode
    return (
      <div className="min-w-[160px] rounded-lg border border-kumo-line bg-kumo-elevated p-1 shadow-xl">
        {current.length > 0 && (
          <button
            onClick={(event) => { event.stopPropagation(); onClear() }}
            className="flex items-center gap-2 w-full px-2.5 py-1.5 text-[11px] rounded transition-colors text-left text-kumo-default hover:bg-kumo-fill"
          >
            <XCircle size={12} />
            Clear all
          </button>
        )}

        {allLabels.map((label) => {
          const colors = LABEL_COLORS[label.colorKey]
          const isSelected = currentSet.has(label.id)
          const isCustom = !label.builtIn
          return (
            <div key={label.id} className="group/label flex items-center">
              <button
                onClick={(event) => { event.stopPropagation(); onToggle(label.id) }}
                className={`flex items-center gap-2 flex-1 min-w-0 px-2.5 py-1.5 text-[11px] rounded transition-colors text-left ${
                  isSelected
                    ? 'bg-kumo-interact/12 text-kumo-link'
                    : 'text-kumo-default hover:bg-kumo-fill'
                }`}
              >
                <span className="w-3 shrink-0 flex items-center justify-center">
                  {isSelected ? <Check size={10} weight="bold" /> : null}
                </span>
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
              {isSelected && !onDeleteLabel && (
                <button
                  onClick={(event) => { event.stopPropagation(); onToggle(label.id) }}
                  className="shrink-0 p-1 mr-1 rounded text-kumo-subtle hover:text-kumo-default hover:bg-kumo-fill transition-colors opacity-0 group-hover/label:opacity-100"
                  title={`Remove ${label.name}`}
                >
                  <X size={10} />
                </button>
              )}
            </div>
          )
        })}

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
    )
  }

  return (
    <div ref={triggerRef} className={`relative inline-flex ${extraClass ?? ''}`}>
      {trigger}
      <PortaledMenu
        open={open}
        triggerRef={triggerRef}
        placement={placement}
        onDismiss={close}
      >
        {renderMenu()}
      </PortaledMenu>
    </div>
  )
}
