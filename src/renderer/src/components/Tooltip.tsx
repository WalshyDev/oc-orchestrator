import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface TooltipProps {
  content: ReactNode
  children: ReactNode
  delay?: number
  position?: 'top' | 'bottom'
}

const GAP = 8
const VIEWPORT_PADDING = 8

export function Tooltip({ content, children, delay = 1000, position = 'top' }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
  }

  useEffect(() => clearTimer, [])

  // After the tooltip renders, clamp it within the viewport
  const clampToViewport = useCallback((node: HTMLDivElement | null) => {
    tooltipRef.current = node
    if (!node) return
    const rect = node.getBoundingClientRect()
    const overflowRight = rect.right - (window.innerWidth - VIEWPORT_PADDING)
    const overflowLeft = VIEWPORT_PADDING - rect.left
    if (overflowRight > 0) {
      node.style.left = `${parseFloat(node.style.left) - overflowRight}px`
    } else if (overflowLeft > 0) {
      node.style.left = `${parseFloat(node.style.left) + overflowLeft}px`
    }
  }, [])

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
          ref={clampToViewport}
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
