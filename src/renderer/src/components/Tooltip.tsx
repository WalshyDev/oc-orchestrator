import { useState, useRef, useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface TooltipProps {
  content: ReactNode
  children: ReactNode
  delay?: number
  position?: 'top' | 'bottom'
}

const GAP = 8

export function Tooltip({ content, children, delay = 1000, position = 'top' }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
  }

  useEffect(() => clearTimer, [])

  const showTooltip = () => {
    timerRef.current = setTimeout(() => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (rect) {
        const left = rect.left + rect.width / 2
        const top = position === 'top' ? rect.top - GAP : rect.bottom + GAP
        setCoords({ top, left })
      }
      setVisible(true)
    }, delay)
  }

  const hideTooltip = () => {
    clearTimer()
    setVisible(false)
    setCoords(null)
  }

  return (
    <div
      ref={triggerRef}
      className="inline-flex"
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
    >
      {children}
      {visible && coords && createPortal(
        <div
          className="fixed z-[200] pointer-events-none"
          style={{
            top: coords.top,
            left: coords.left,
            transform: position === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
            animation: 'tooltip-fade-in 150ms ease-out',
          }}
        >
          {content}
        </div>,
        document.body,
      )}
    </div>
  )
}
