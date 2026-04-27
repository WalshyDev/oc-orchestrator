import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react'
import { ChatCircleDots, DotsSixVertical, PaperPlaneTilt, X } from '@phosphor-icons/react'

/** The selection being quoted into the agent message. */
export interface HighlightSelection {
  /** Exact text the user selected. Already trimmed of leading/trailing whitespace-only
   *  lines but inner structure preserved. */
  text: string
  /** Human-readable source label (e.g. "src/foo.ts:42-50" or "message from assistant"). */
  source: string
  /** Optional language hint for the quoted code fence. If absent, no language tag is applied. */
  language?: string
}

/** Viewport rectangle of the user's text selection. The popover uses this to
 *  pick a side (above/below) with more room rather than always anchoring
 *  beneath the selection end. */
export interface SelectionRect {
  top: number
  bottom: number
  left: number
  right: number
}

interface HighlightAskPopoverProps {
  /** The selection's bounding rect in viewport coordinates. The popover
   *  picks above-vs-below based on which side has more room and clamps
   *  horizontally to fit. */
  selectionRect: SelectionRect
  /** What the user highlighted — shown in a preview strip at the top of the popover. */
  selection: HighlightSelection
  /** Called when the user sends. Receives the full composed message (citation + question). */
  onSend: (message: string) => void
  /** Dismiss without sending. */
  onClose: () => void
}

const MAX_PREVIEW_CHARS = 160
/** Popover width in px. Mirrors the `w-[400px]` class below; kept in sync
 *  manually so the off-screen clamp math can reason about dimensions. */
const POPOVER_WIDTH = 400
/** Conservative height estimate used only for placement \u2014 real height varies
 *  with preview size. Slightly oversized so the popover never touches the
 *  window edge when there's room to fit. */
const POPOVER_MAX_HEIGHT = 320
/** Minimum distance from viewport edges so the popover doesn't butt against
 *  the screen corner. */
const VIEWPORT_MARGIN = 12
/** Vertical gap between the selection and the popover so they don't touch. */
const ANCHOR_GAP = 8

/**
 * Floating composer that shows a preview of a code/text selection and lets
 * the user ask a quick question about it. Composes the final message as a
 * markdown-quoted citation followed by the user's question, so the agent
 * sees the snippet with full context when replying.
 *
 * Placement: prefers below the selection, but if there's not enough room
 * below it flips above. The user can drag the popover anywhere by the
 * header — useful when the auto-placement still lands somewhere awkward
 * (e.g. selection spans most of the viewport).
 */
export function HighlightAskPopover({ selectionRect, selection, onSend, onClose }: HighlightAskPopoverProps) {
  const [question, setQuestion] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Position is null until first layout. We compute the smart default in
  // useLayoutEffect so we have the actual popover height available; before
  // then we render off-screen to avoid a flicker at (0, 0).
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  // Once the user drags, stop re-applying the smart default on resize.
  const [userPositioned, setUserPositioned] = useState(false)

  // Autofocus the textarea on open. requestAnimationFrame avoids losing
  // focus to the selection-change event that triggered the popover.
  useEffect(() => {
    const frame = requestAnimationFrame(() => textareaRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])

  // Dismiss on outside click / Escape.
  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (containerRef.current?.contains(target)) return
      onClose()
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleKey, true)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKey, true)
    }
  }, [onClose])

  // Smart default placement. Runs once after first paint so we know the
  // popover's actual height (we use the rendered DOM rect, not the constant
  // estimate). Picks above-vs-below by which side has more room.
  useLayoutEffect(() => {
    if (userPositioned) return
    setPosition(computeSmartPosition(selectionRect, containerRef.current?.offsetHeight ?? POPOVER_MAX_HEIGHT))
  }, [selectionRect, userPositioned])

  const handleSend = useCallback(() => {
    const trimmed = question.trim()
    if (!trimmed) return
    const message = composeCitationMessage(selection, trimmed)
    onSend(message)
  }, [question, selection, onSend])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Skip composition events (IME candidates) so Enter doesn't send mid-typing.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      handleSend()
    }
  }

  // ── Drag handling ────────────────────────────────────────────────────────
  // Header acts as a drag handle. We track an offset from the pointer to the
  // popover origin at mousedown, then update absolute position on each
  // mousemove. Pointer capture isn't strictly necessary — listening on
  // window during the drag handles fast moves where the cursor leaves the
  // header.
  const dragStateRef = useRef<{ offsetX: number; offsetY: number } | null>(null)

  const handleDragStart = (event: React.PointerEvent) => {
    if (!position || !containerRef.current) return
    // Don't initiate a drag from the close button (it has its own click).
    if ((event.target as HTMLElement).closest('button')) return
    event.preventDefault()
    dragStateRef.current = {
      offsetX: event.clientX - position.x,
      offsetY: event.clientY - position.y
    }
    setUserPositioned(true)

    const handleMove = (moveEvent: PointerEvent) => {
      const drag = dragStateRef.current
      if (!drag) return
      const x = clampX(moveEvent.clientX - drag.offsetX)
      const y = clampY(moveEvent.clientY - drag.offsetY, containerRef.current?.offsetHeight ?? POPOVER_MAX_HEIGHT)
      setPosition({ x, y })
    }
    const handleUp = () => {
      dragStateRef.current = null
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }

  const previewText = selection.text.length > MAX_PREVIEW_CHARS
    ? selection.text.slice(0, MAX_PREVIEW_CHARS) + '…'
    : selection.text

  // Render off-screen on first paint so we can measure before the user sees
  // it. Without this the popover briefly flashes at (0, 0).
  const style = position
    ? { left: position.x, top: position.y }
    : { left: -9999, top: -9999, visibility: 'hidden' as const }

  return (
    <div
      ref={containerRef}
      style={style}
      className="fixed z-[9999] w-[400px] rounded-lg border border-neutral-700 bg-neutral-900 shadow-2xl shadow-black/60"
      role="dialog"
      aria-label="Ask about highlighted text"
    >
      <div
        onPointerDown={handleDragStart}
        className="flex items-center justify-between px-3 py-2 border-b border-neutral-800 cursor-grab active:cursor-grabbing select-none"
      >
        <div className="flex items-center gap-1.5 text-xs text-neutral-400">
          <DotsSixVertical weight="bold" className="h-3.5 w-3.5 text-neutral-600" />
          <ChatCircleDots weight="duotone" className="h-3.5 w-3.5" />
          <span className="font-medium">Ask about selection</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-neutral-500 hover:text-neutral-300"
          aria-label="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="px-3 py-2 border-b border-neutral-800">
        <div className="text-[10px] uppercase tracking-wide text-neutral-500 mb-1 font-mono">{selection.source}</div>
        <pre className="text-[11px] text-neutral-300 bg-neutral-950 rounded border border-neutral-800 px-2 py-1.5 max-h-36 overflow-auto whitespace-pre font-mono leading-snug">
          {previewText}
        </pre>
      </div>

      <div className="p-2">
        <textarea
          ref={textareaRef}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="What do you want to ask?"
          rows={3}
          className="w-full resize-none bg-neutral-950 border border-neutral-800 rounded px-2 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-sky-500/50 focus:border-sky-500/50"
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-[10px] text-neutral-500">Enter to send · Shift+Enter for newline</span>
          <button
            type="button"
            onClick={handleSend}
            disabled={!question.trim()}
            className="flex items-center gap-1 px-2 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <PaperPlaneTilt weight="fill" className="h-3 w-3" />
            Send
          </button>
        </div>
      </div>
    </div>
  )
}

/** Compose a markdown-quoted citation block plus the user's question. */
export function composeCitationMessage(selection: HighlightSelection, question: string): string {
  const fence = selection.language ? '```' + selection.language : '```'
  return [
    `> \`${selection.source}\``,
    '>',
    `> ${fence}`,
    ...selection.text.split('\n').map((line) => `> ${line}`),
    '> ```',
    '',
    question
  ].join('\n')
}

/** Pick a position that fits the popover relative to the selection, preferring
 *  whichever side (above or below) has more room. Falls back to clamping if
 *  neither side has enough room. */
function computeSmartPosition(rect: SelectionRect, popoverHeight: number): { x: number; y: number } {
  const viewportHeight = window.innerHeight
  const roomAbove = rect.top - VIEWPORT_MARGIN
  const roomBelow = viewportHeight - rect.bottom - VIEWPORT_MARGIN

  let y: number
  if (roomBelow >= popoverHeight + ANCHOR_GAP) {
    // Default: below the selection.
    y = rect.bottom + ANCHOR_GAP
  } else if (roomAbove >= popoverHeight + ANCHOR_GAP) {
    // Flip above when there's room there but not below.
    y = rect.top - popoverHeight - ANCHOR_GAP
  } else {
    // Neither side fits cleanly; pick the side with more room and clamp.
    y = roomBelow >= roomAbove
      ? Math.max(VIEWPORT_MARGIN, viewportHeight - popoverHeight - VIEWPORT_MARGIN)
      : VIEWPORT_MARGIN
  }

  return {
    x: clampX(rect.left),
    y: clampY(y, popoverHeight)
  }
}

function clampX(x: number): number {
  return Math.max(VIEWPORT_MARGIN, Math.min(x, window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN))
}

function clampY(y: number, popoverHeight: number): number {
  return Math.max(VIEWPORT_MARGIN, Math.min(y, window.innerHeight - popoverHeight - VIEWPORT_MARGIN))
}
