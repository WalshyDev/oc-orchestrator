import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface TooltipProps {
  content: ReactNode
  children: ReactNode
  delay?: number
  position?: 'top' | 'bottom'
  interactive?: boolean
}

const GAP = 8
const VIEWPORT_PADDING = 8
const LEAVE_GRACE_MS = 150

export function Tooltip({ content, children, delay = 1000, position = 'top', interactive = false }: TooltipProps) {
  const [pending, setPending] = useState(false)
  const [finalCoords, setFinalCoords] = useState<{ top: number; left: number } | null>(null)
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<{ centerX: number; anchorY: number } | null>(null)

  const clearShowTimer = () => {
    if (showTimerRef.current) clearTimeout(showTimerRef.current)
    showTimerRef.current = null
  }

  const clearHideTimer = () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = null
  }

  useEffect(() => () => {
    clearShowTimer()
    clearHideTimer()
  }, [])

  const measureAndPlace = useCallback((node: HTMLDivElement | null) => {
    if (!node || !anchorRef.current) return
    const { centerX, anchorY } = anchorRef.current
    const tooltipW = node.getBoundingClientRect().width
    const tooltipH = node.getBoundingClientRect().height

    let left = centerX - tooltipW / 2
    left = Math.max(VIEWPORT_PADDING, Math.min(left, window.innerWidth - tooltipW - VIEWPORT_PADDING))

    const top = position === 'top' ? anchorY - tooltipH : anchorY

    setFinalCoords({ top, left })
  }, [position])

  const isVisible = pending || finalCoords !== null

  const dismiss = () => {
    clearShowTimer()
    clearHideTimer()
    setPending(false)
    setFinalCoords(null)
    anchorRef.current = null
  }

  const startShow = () => {
    clearHideTimer()
    if (isVisible) return
    showTimerRef.current = setTimeout(() => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      anchorRef.current = {
        centerX: rect.left + rect.width / 2,
        anchorY: position === 'top' ? rect.top - GAP : rect.bottom + GAP,
      }
      setPending(true)
    }, delay)
  }

  const startHide = () => {
    clearShowTimer()
    if (interactive) {
      hideTimerRef.current = setTimeout(dismiss, LEAVE_GRACE_MS)
    } else {
      dismiss()
    }
  }

  const tooltipHandlers = interactive ? {
    onMouseEnter: clearHideTimer,
    onMouseLeave: dismiss,
  } : {}

  const pointerEvents = interactive ? 'auto' : 'none'

  return (
    <div
      ref={triggerRef}
      className="inline-flex"
      onMouseEnter={startShow}
      onMouseLeave={startHide}
    >
      {children}
      {pending && !finalCoords && createPortal(
        <div
          ref={measureAndPlace}
          className="fixed z-[200]"
          style={{ opacity: 0, top: 0, left: 0, pointerEvents: 'none' }}
        >
          {content}
        </div>,
        document.body,
      )}
      {finalCoords && createPortal(
        <div
          className="fixed z-[200]"
          onClick={interactive ? (e) => e.stopPropagation() : undefined}
          style={{
            top: finalCoords.top,
            left: finalCoords.left,
            pointerEvents,
            animation: 'tooltip-fade-in 150ms ease-out',
          }}
          {...tooltipHandlers}
        >
          {content}
        </div>,
        document.body,
      )}
    </div>
  )
}
