import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface TooltipProps {
  content: ReactNode
  children: ReactNode
  delay?: number
  position?: 'top' | 'bottom'
}

interface FinalCoords {
  top: number
  left: number
}

const GAP = 8
const VIEWPORT_PADDING = 8

export function Tooltip({ content, children, delay = 1000, position = 'top' }: TooltipProps) {
  const [pending, setPending] = useState(false)
  const [finalCoords, setFinalCoords] = useState<FinalCoords | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<{ centerX: number; anchorY: number } | null>(null)

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
  }

  useEffect(() => clearTimer, [])

  // Ref callback on the hidden tooltip: measure it, compute clamped position, then reveal
  const measureAndPlace = useCallback((node: HTMLDivElement | null) => {
    if (!node || !anchorRef.current) return
    const { centerX, anchorY } = anchorRef.current
    const tooltipRect = node.getBoundingClientRect()
    const tooltipW = tooltipRect.width
    const tooltipH = tooltipRect.height

    let left = centerX - tooltipW / 2
    left = Math.max(VIEWPORT_PADDING, Math.min(left, window.innerWidth - tooltipW - VIEWPORT_PADDING))

    const top = position === 'top' ? anchorY - tooltipH : anchorY

    setFinalCoords({ top, left })
  }, [position])

  const showTooltip = () => {
    timerRef.current = setTimeout(() => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      anchorRef.current = {
        centerX: rect.left + rect.width / 2,
        anchorY: position === 'top' ? rect.top - GAP : rect.bottom + GAP,
      }
      setPending(true)
    }, delay)
  }

  const hideTooltip = () => {
    clearTimer()
    setPending(false)
    setFinalCoords(null)
    anchorRef.current = null
  }

  return (
    <div
      ref={triggerRef}
      className="inline-flex"
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
    >
      {children}
      {pending && !finalCoords && createPortal(
        // Hidden measurement render — invisible, no animation
        <div
          ref={measureAndPlace}
          className="fixed z-[200] pointer-events-none"
          style={{ opacity: 0, top: 0, left: 0 }}
        >
          {content}
        </div>,
        document.body,
      )}
      {finalCoords && createPortal(
        <div
          className="fixed z-[200] pointer-events-none"
          style={{
            top: finalCoords.top,
            left: finalCoords.left,
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
