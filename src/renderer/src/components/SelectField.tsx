import { useEffect, useMemo, useRef, useState } from 'react'
import { CaretDown, Check, MagnifyingGlass } from '@phosphor-icons/react'

interface SelectOption {
  value: string
  label: string
}

interface SelectFieldProps {
  value: string
  options: readonly SelectOption[]
  onChange: (value: string) => void
  searchable?: boolean
  searchPlaceholder?: string
  buttonClassName?: string
  menuClassName?: string
}

export function SelectField({
  value,
  options,
  onChange,
  searchable = false,
  searchPlaceholder = 'Search…',
  buttonClassName,
  menuClassName
}: SelectFieldProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const selectedOption = useMemo(() => {
    return options.find((option) => option.value === value) ?? options[0]
  }, [options, value])

  const filteredOptions = useMemo(() => {
    if (!searchable || !search.trim()) return options
    const query = search.toLowerCase()
    return options.filter((option) =>
      option.label.toLowerCase().includes(query) ||
      option.value.toLowerCase().includes(query)
    )
  }, [options, searchable, search])

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

  // Reset search and auto-focus when dropdown opens
  useEffect(() => {
    if (isOpen && searchable) {
      setSearch('')
      requestAnimationFrame(() => searchInputRef.current?.focus())
    }
  }, [isOpen, searchable])

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
          {searchable && (
            <div className="px-2 pt-2 pb-1">
              <div className="relative">
                <MagnifyingGlass size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-kumo-subtle" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="w-full pl-7 pr-2.5 py-1.5 bg-kumo-control border border-kumo-line rounded-md text-xs text-kumo-default outline-none focus:border-kumo-ring placeholder:text-kumo-subtle"
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </div>
            </div>
          )}
          {filteredOptions.length === 0 ? (
            <div className="px-3 py-2 text-xs text-kumo-subtle text-center">No matches</div>
          ) : (
            filteredOptions.map((option) => {
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
            })
          )}
        </div>
      )}
    </div>
  )
}
