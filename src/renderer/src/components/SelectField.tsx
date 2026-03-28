import { useEffect, useMemo, useRef, useState } from 'react'
import { CaretDown, Check } from '@phosphor-icons/react'

interface SelectOption {
  value: string
  label: string
}

interface SelectFieldProps {
  value: string
  options: readonly SelectOption[]
  onChange: (value: string) => void
  buttonClassName?: string
  menuClassName?: string
}

export function SelectField({
  value,
  options,
  onChange,
  buttonClassName,
  menuClassName
}: SelectFieldProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const selectedOption = useMemo(() => {
    return options.find((option) => option.value === value) ?? options[0]
  }, [options, value])

  useEffect(() => {
    if (!isOpen) return

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)

    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((previous) => !previous)}
        className={buttonClassName}
      >
        <span className="truncate text-left">{selectedOption?.label ?? value}</span>
        <CaretDown size={14} className={`shrink-0 text-kumo-subtle transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div
          role="listbox"
          className={menuClassName}
        >
          {options.map((option) => {
            const isSelected = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(option.value)
                  setIsOpen(false)
                }}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors ${
                  isSelected
                    ? 'bg-kumo-fill text-kumo-strong'
                    : 'text-kumo-default hover:bg-kumo-fill'
                }`}
              >
                <span className="truncate">{option.label}</span>
                <Check size={14} className={isSelected ? 'text-kumo-brand' : 'invisible'} />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
