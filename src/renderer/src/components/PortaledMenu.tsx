import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/** Where to anchor the menu relative to the trigger button. */
export type MenuPlacement =
  /** Above the trigger, right edge aligned. */
  | 'top-right'
  /** Above the trigger, left edge aligned. */
  | 'top-left'
  /** Below the trigger, right edge aligned. */
  | 'bottom-right'
  /** Below the trigger, left edge aligned. */
  | 'bottom-left'

interface MenuCoords {
  top?: number
  bottom?: number
  left?: number
  right?: number
}

function computeCoords(rect: DOMRect, placement: MenuPlacement, gap: number): MenuCoords {
  // Use viewport-relative coords so `position: fixed` in the portaled menu
  // sits exactly where the trigger would have placed an absolute child, but
  // without any overflow-clipping from the trigger's ancestors.
  switch (placement) {
    case 'top-right':
      return { bottom: window.innerHeight - rect.top + gap, right: window.innerWidth - rect.right }
    case 'top-left':
      return { bottom: window.innerHeight - rect.top + gap, left: rect.left }
    case 'bottom-right':
      return { top: rect.bottom + gap, right: window.innerWidth - rect.right }
    case 'bottom-left':
      return { top: rect.bottom + gap, left: rect.left }
  }
}

interface PortaledMenuProps {
  open: boolean
  triggerRef: React.RefObject<HTMLElement | null>
  placement: MenuPlacement
  onDismiss: () => void
  /** Gap in px between trigger and menu (default 4). */
  gap?: number
  /** Anything clicked inside this ref is treated as "inside" and does not
   *  dismiss. Use for nested popovers or input fields that live within the
   *  menu body. */
  children: React.ReactNode
  className?: string
}

/**
 * Renders its children at document.body, positioned relative to a trigger
 * element. Handles click-outside and Escape-to-close. Reposition on scroll
 * and window resize so the menu tracks its trigger.
 */
export function PortaledMenu({
  open,
  triggerRef,
  placement,
  onDismiss,
  gap = 4,
  children,
  className
}: PortaledMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [coords, setCoords] = useState<MenuCoords | null>(null)

  // Compute position synchronously after the browser lays out the trigger,
  // so the menu appears in the right place on the first paint after open.
  useLayoutEffect(() => {
    if (!open) {
      setCoords(null)
      return
    }
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) setCoords(computeCoords(rect, placement, gap))
  }, [open, placement, gap, triggerRef])

  // Keep the menu pinned to its trigger when the user scrolls or resizes.
  useEffect(() => {
    if (!open) return
    const reposition = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (rect) setCoords(computeCoords(rect, placement, gap))
    }
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open, placement, gap, triggerRef])

  // Click-outside + Escape dismissal. Check both the trigger and the portaled
  // menu — clicks inside either count as "inside".
  useEffect(() => {
    if (!open) return
    const onClick = (event: MouseEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      onDismiss()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss()
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, triggerRef, onDismiss])

  if (!open || !coords) return null

  return createPortal(
    <div
      ref={menuRef}
      className={`fixed z-[200] ${className ?? ''}`}
      style={coords}
    >
      {children}
    </div>,
    document.body
  )
}
