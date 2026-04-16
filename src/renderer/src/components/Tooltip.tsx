import { useState, useRef, useEffect, type ReactNode } from 'react'

interface TooltipProps {
  content: ReactNode
  children: ReactNode
  delay?: number
  position?: 'top' | 'bottom'
}

const positionStyles = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
} as const

export function Tooltip({ content, children, delay = 1000, position = 'top' }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
  }

  useEffect(() => clearTimer, [])

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={() => {
        timerRef.current = setTimeout(() => setVisible(true), delay)
      }}
      onMouseLeave={() => {
        clearTimer()
        setVisible(false)
      }}
    >
      {children}
      {visible && (
        <div
          className={`absolute ${positionStyles[position]} z-[200] pointer-events-none`}
          style={{ animation: 'tooltip-fade-in 150ms ease-out' }}
        >
          {content}
        </div>
      )}
    </div>
  )
}
