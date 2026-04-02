import { useState, useRef, useEffect } from 'react'
import {
  CaretDown,
  CheckCircle,
  Eye,
  Warning,
  ArrowsClockwise
} from '@phosphor-icons/react'
import type { StatusOverride } from '../types'
import { statusOverrideLabel } from '../types'

const OVERRIDE_OPTIONS: { value: StatusOverride | null; label: string; icon: React.ReactNode }[] = [
  { value: null, label: 'Auto', icon: <ArrowsClockwise size={12} /> },
  { value: 'completed_manual', label: 'Completed', icon: <CheckCircle size={12} /> },
  { value: 'in_review', label: 'In Review', icon: <Eye size={12} /> },
  { value: 'blocked_manual', label: 'Blocked', icon: <Warning size={12} /> }
]

interface StatusDropdownProps {
  current: StatusOverride | null
  onSelect: (override: StatusOverride | null) => void
  variant?: 'row' | 'action'
}

export function StatusDropdown({ current, onSelect, variant = 'row' }: StatusDropdownProps) {
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

  const currentLabel = statusOverrideLabel(current)

  if (variant === 'action') {
    return (
      <div ref={containerRef} className="relative">
        <button
          onClick={(event) => { event.stopPropagation(); setOpen(!open) }}
          className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-md border bg-kumo-control border-kumo-line text-kumo-default hover:bg-kumo-fill transition-colors"
        >
          {OVERRIDE_OPTIONS.find((o) => o.value === current)?.icon}
          {currentLabel}
          <CaretDown size={10} className="ml-0.5" />
        </button>
        {open && (
          <div className="absolute bottom-full left-0 mb-1 z-[100] min-w-[140px] rounded-lg border border-kumo-line bg-kumo-elevated p-1 shadow-xl">
            {OVERRIDE_OPTIONS.map((option) => (
              <button
                key={option.label}
                onClick={(event) => {
                  event.stopPropagation()
                  onSelect(option.value)
                  setOpen(false)
                }}
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

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={(event) => { event.stopPropagation(); setOpen(!open) }}
        className="w-6 h-6 flex items-center justify-center bg-kumo-fill border border-kumo-line rounded text-kumo-subtle hover:bg-kumo-fill-hover hover:text-kumo-default transition-colors cursor-pointer"
        title={`Status: ${currentLabel}`}
      >
        <CaretDown size={10} />
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 z-[100] min-w-[140px] rounded-lg border border-kumo-line bg-kumo-elevated p-1 shadow-xl">
          {OVERRIDE_OPTIONS.map((option) => (
            <button
              key={option.label}
              onClick={(event) => {
                event.stopPropagation()
                onSelect(option.value)
                setOpen(false)
              }}
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
