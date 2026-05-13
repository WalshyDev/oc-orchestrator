import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
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
  width?: number
}

interface MenuSize {
  width: number
  height: number
}

/** Minimum gap between the menu and the viewport edge when flipping/clamping. */
const VIEWPORT_PADDING = 4

function isLeftPlacement(placement: MenuPlacement): boolean {
  return placement === 'top-left' || placement === 'bottom-left'
}

function isTopPlacement(placement: MenuPlacement): boolean {
  return placement === 'top-left' || placement === 'top-right'
}

function sameCoords(a: MenuCoords | null, b: MenuCoords): boolean {
  if (!a) return false
  return (
    a.top === b.top &&
    a.bottom === b.bottom &&
    a.left === b.left &&
    a.right === b.right &&
    a.width === b.width
  )
}

/**
 * Pick the placement that keeps the menu on screen.
 *
 * Horizontal flip: 'left'-anchored menus extend rightward from rect.left;
 * 'right'-anchored menus extend leftward from rect.right. Skipped when the
 * menu's width is locked to the trigger (the menu is always on-screen
 * horizontally as long as the trigger is).
 *
 * Vertical flip: 'top'-anchored menus extend upward from rect.top;
 * 'bottom'-anchored menus extend downward from rect.bottom.
 */
function resolvePlacement(
  rect: DOMRect,
  placement: MenuPlacement,
  menuSize: MenuSize,
  matchTriggerWidth: boolean
): MenuPlacement {
  let effective = placement

  if (!matchTriggerWidth) {
    const overflowsRight = rect.left + menuSize.width > window.innerWidth - VIEWPORT_PADDING
    const overflowsLeft = rect.right - menuSize.width < VIEWPORT_PADDING
    if (isLeftPlacement(effective) && overflowsRight) {
      effective = effective === 'top-left' ? 'top-right' : 'bottom-right'
    } else if (!isLeftPlacement(effective) && overflowsLeft) {
      effective = effective === 'top-right' ? 'top-left' : 'bottom-left'
    }
  }

  const overflowsTop = rect.top - menuSize.height < VIEWPORT_PADDING
  const overflowsBottom = rect.bottom + menuSize.height > window.innerHeight - VIEWPORT_PADDING
  const leftAnchored = isLeftPlacement(effective)
  if (isTopPlacement(effective) && overflowsTop) {
    effective = leftAnchored ? 'bottom-left' : 'bottom-right'
  } else if (!isTopPlacement(effective) && overflowsBottom) {
    effective = leftAnchored ? 'top-left' : 'top-right'
  }

  return effective
}

/**
 * Compute the viewport-relative coords for the portaled menu. Position is
 * `position: fixed`, so coords are measured from the viewport edges. When the
 * menu has been rendered once we also flip placement on overflow.
 */
function computeCoords(
  rect: DOMRect,
  placement: MenuPlacement,
  gap: number,
  menuSize: MenuSize | undefined,
  matchTriggerWidth: boolean
): MenuCoords {
  const effective = menuSize
    ? resolvePlacement(rect, placement, menuSize, matchTriggerWidth)
    : placement

  const width = matchTriggerWidth ? rect.width : undefined

  switch (effective) {
    case 'top-right':
      return {
        bottom: window.innerHeight - rect.top + gap,
        right: window.innerWidth - rect.right,
        width
      }
    case 'top-left':
      return {
        bottom: window.innerHeight - rect.top + gap,
        left: rect.left,
        width
      }
    case 'bottom-right':
      return {
        top: rect.bottom + gap,
        right: window.innerWidth - rect.right,
        width
      }
    case 'bottom-left':
      return {
        top: rect.bottom + gap,
        left: rect.left,
        width
      }
  }
}

interface PortaledMenuProps {
  open: boolean
  triggerRef: React.RefObject<HTMLElement | null>
  placement: MenuPlacement
  onDismiss: () => void
  /** Gap in px between trigger and menu (default 4). */
  gap?: number
  /** When true, the menu's width is forced to match the trigger's width.
   *  Useful for select-style dropdowns and autocomplete popovers anchored
   *  to a textarea or input. Defaults to false. */
  matchTriggerWidth?: boolean
  children: React.ReactNode
  className?: string
}

/**
 * Renders its children at document.body, positioned relative to a trigger
 * element. Handles click-outside and Escape-to-close. Repositions on scroll
 * and window resize so the menu tracks its trigger.
 */
export function PortaledMenu({
  open,
  triggerRef,
  placement,
  onDismiss,
  gap = 4,
  matchTriggerWidth = false,
  children,
  className
}: PortaledMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [coords, setCoords] = useState<MenuCoords | null>(null)

  // Position the menu in two passes. First pass renders at the requested
  // placement (menuSize unknown). Second pass measures the rendered menu and
  // flips to the opposite side if it would overflow the viewport. The flip
  // runs synchronously in a layout effect so users never see the off-screen
  // frame. We coalesce equal coords to avoid an infinite update loop.
  const reposition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const menuRect = menuRef.current?.getBoundingClientRect()
    const menuSize = menuRect ? { width: menuRect.width, height: menuRect.height } : undefined
    const next = computeCoords(rect, placement, gap, menuSize, matchTriggerWidth)
    setCoords((prev) => (sameCoords(prev, next) ? prev : next))
  }, [triggerRef, placement, gap, matchTriggerWidth])

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null)
      return
    }
    reposition()
  })

  // Keep the menu pinned to its trigger when the user scrolls or resizes.
  useEffect(() => {
    if (!open) return
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open, reposition])

  // Click-outside + Escape dismissal. Clicks on the trigger or inside the
  // portaled menu count as "inside" and don't dismiss.
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
