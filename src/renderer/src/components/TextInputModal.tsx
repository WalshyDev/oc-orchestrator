import { useState, useEffect, useRef } from 'react'

interface TextInputModalProps {
  title: string
  initialValue?: string
  submitLabel?: string
  placeholder?: string
  allowEmpty?: boolean
  onSubmit: (value: string) => void
  onClose: () => void
}

export function TextInputModal({
  title,
  initialValue = '',
  submitLabel = 'Save',
  placeholder,
  allowEmpty = false,
  onSubmit,
  onClose
}: TextInputModalProps) {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const canSubmit = allowEmpty || !!value.trim()

  const handleSubmit = () => {
    if (canSubmit) onSubmit(value.trim())
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      handleSubmit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-80 rounded-lg border border-kumo-line bg-kumo-elevated p-4 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="text-sm font-semibold text-kumo-strong mb-3">{title}</div>
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full px-2.5 py-1.5 bg-kumo-control border border-kumo-line rounded-md text-sm text-kumo-default outline-none focus:border-kumo-ring"
        />
        <div className="flex justify-end gap-2 mt-3">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-kumo-line text-kumo-default hover:bg-kumo-fill transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-kumo-brand text-white hover:bg-kumo-brand-hover transition-colors disabled:opacity-40"
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
