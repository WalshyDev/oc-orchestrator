import { useState, useRef, useEffect } from 'react'
import {
  CaretDown,
  CheckCircle,
  Eye,
  Warning,
  PencilSimpleLine,
  XCircle,
  Tag
} from '@phosphor-icons/react'
import type { AgentLabel } from '../types'
import { agentLabelDisplay } from '../types'

const LABEL_OPTIONS: { value: AgentLabel | null; label: string; icon: React.ReactNode }[] = [
  { value: null, label: 'None', icon: <XCircle size={12} /> },
  { value: 'draft', label: 'Draft', icon: <PencilSimpleLine size={12} /> },
  { value: 'in_review', label: 'In Review', icon: <Eye size={12} /> },
  { value: 'blocked', label: 'Blocked', icon: <Warning size={12} /> },
  { value: 'done', label: 'Done', icon: <CheckCircle size={12} /> }
]

interface LabelDropdownProps {
  current: AgentLabel | null
  onSelect: (label: AgentLabel | null) => void
  variant?: 'row' | 'action' | 'inline'
}

export function LabelDropdown({ current, onSelect, variant = 'row' }: LabelDropdownProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  const selectAndClose = (value: AgentLabel | null) => {
    onSelect(value)
    setOpen(false)
  }

  const toggle = (event: React.MouseEvent) => {
    event.stopPropagation()
    setOpen(!open)
  }

  const currentLabel = agentLabelDisplay(current)

  let menuPosition: string
  let trigger: React.ReactNode

  switch (variant) {
    case 'action':
      menuPosition = 'absolute bottom-full left-0 mb-1'
      trigger = (
        <button
          onClick={toggle}
          className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-md border bg-kumo-control border-kumo-line text-kumo-default hover:bg-kumo-fill transition-colors"
        >
          {LABEL_OPTIONS.find((o) => o.value === current)?.icon}
          {currentLabel}
          <CaretDown size={10} className="ml-0.5" />
        </button>
      )
      break

    case 'inline':
      menuPosition = 'absolute top-full left-0 mt-1'
      trigger = current ? (
        <button
          onClick={toggle}
          className="inline-flex items-center px-1.5 py-px rounded text-[10px] font-medium bg-kumo-brand/10 text-kumo-brand hover:bg-kumo-brand/20 transition-colors cursor-pointer"
          title="Change label"
        >
          {agentLabelDisplay(current)}
        </button>
      ) : (
        <button
          onClick={toggle}
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
          onClick={toggle}
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
        <div className={`${menuPosition} z-[100] min-w-[140px] rounded-lg border border-kumo-line bg-kumo-elevated p-1 shadow-xl`}>
          {LABEL_OPTIONS.map((option) => (
            <button
              key={option.label}
              onClick={(event) => { event.stopPropagation(); selectAndClose(option.value) }}
              className={`flex items-center gap-2 w-full px-2.5 py-1.5 text-[11px] rounded transition-colors text-left ${
                option.value === current
                  ? 'bg-kumo-interact/12 text-kumo-link'
                  : 'text-kumo-default hover:bg-kumo-fill'
              }`}
            >
              {option.icon}
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
