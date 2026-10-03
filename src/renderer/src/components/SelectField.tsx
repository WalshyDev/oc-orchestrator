import { useEffect, useMemo, useRef, useState } from 'react'
import { CaretDown, Check, MagnifyingGlass } from '@phosphor-icons/react'
import { PortaledMenu } from './PortaledMenu'
import { prioritizeRecentOptions } from '../hooks/useRecentModels'

interface SelectOption {
  value: string
  label: string
}

export interface SelectFieldProps {
  value: string
  options: readonly SelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
  searchable?: boolean
  searchPlaceholder?: string
  buttonClassName?: string
  /**
   * Style-only classes for the dropdown menu (background, border, etc.).
   * Position is handled by PortaledMenu — strip any `absolute`/`top-*`/
   * `bottom-*`/`left-*`/`right-*`/`mt-*` classes from this string.
   */
  menuClassName?: string
  recentValues?: readonly string[]
}

export function SelectField({
  value,
  options,
  onChange,
  disabled = false,
  searchable = false,
  searchPlaceholder = 'Search…',
  buttonClassName,
  menuClassName,
  recentValues = []
}: SelectFieldProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const buttonRef = useRef<HTMLButtonElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const selectedOption = useMemo(() => {
    return options.find((option) => option.value === value) ?? options[0]
  }, [options, value])

  const filteredOptions = useMemo(() => {
    const query = searchable ? search.trim().toLowerCase() : ''
    const matches = options.filter((option) =>
      option.label.toLowerCase().includes(query) ||
      option.value.toLowerCase().includes(query)
    )
    return prioritizeRecentOptions(matches, recentValues)
  }, [options, recentValues, searchable, search])

  // Reset search and auto-focus when dropdown opens
  useEffect(() => {
    if (isOpen && searchable) {
      setSearch('')
      requestAnimationFrame(() => searchInputRef.current?.focus())
    }
  }, [isOpen, searchable])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        disabled={disabled}
        onClick={() => setIsOpen((previous) => !previous)}
        className={buttonClassName}
      >
        <span className="truncate text-left">{selectedOption?.label ?? value}</span>
        <CaretDown size={14} className={`shrink-0 text-kumo-subtle transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      <PortaledMenu
        open={isOpen && !disabled}
        triggerRef={buttonRef}
        placement="bottom-left"
        matchTriggerWidth
        onDismiss={() => setIsOpen(false)}
        className={menuClassName}
      >
        <div role="listbox">
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
                  <span className="flex shrink-0 items-center gap-2">
                    {recentValues.includes(option.value) && (
                      <span className="text-[10px] text-kumo-subtle">Recently used</span>
                    )}
                    <Check size={14} className={isSelected ? 'text-kumo-brand' : 'invisible'} />
                  </span>
                </button>
              )
            })
          )}
        </div>
      </PortaledMenu>
    </>
  )
}
