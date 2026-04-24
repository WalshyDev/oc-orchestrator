import { useEffect, useRef, useState, useCallback } from 'react'
import { ChatCircleDots, PaperPlaneTilt, X } from '@phosphor-icons/react'

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

interface HighlightAskPopoverProps {
  /** Absolute viewport position where the popover anchors (typically near the selection end). */
  anchor: { x: number; y: number }
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
/** Conservative height estimate used only for clamping — real height varies
 *  with preview size. Slightly oversized so the popover never touches the
 *  window edge. */
const POPOVER_MAX_HEIGHT = 220
/** Minimum distance from viewport edges so the popover doesn't butt against
 *  the screen corner. */
const VIEWPORT_MARGIN = 8

/**
 * Floating composer that shows a preview of a code/text selection and lets the
 * user ask a quick question about it. Composes the final message as a
 * markdown-quoted citation followed by the user's question, so the agent sees
 * the snippet with full context when replying.
 *
 * Used from two entry points:
 *   - Monaco editor/diff selection in the Workspace view
 *   - Text selection inside the DetailDrawer Messages tab
 */
export function HighlightAskPopover({ anchor, selection, onSend, onClose }: HighlightAskPopoverProps) {
  const [question, setQuestion] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Autofocus the textarea on open. Using requestAnimationFrame avoids
  // losing focus to the selection-change event that triggered the popover.
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

  // Clamp so the popover never slides off-screen. The caller picks the
  // anchor near the selection end, and we just ensure it fits.
  const clampedX = Math.max(
    VIEWPORT_MARGIN,
    Math.min(anchor.x, window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN)
  )
  const clampedY = Math.max(
    VIEWPORT_MARGIN,
    Math.min(anchor.y, window.innerHeight - POPOVER_MAX_HEIGHT - VIEWPORT_MARGIN)
  )

  const previewText = selection.text.length > MAX_PREVIEW_CHARS
    ? selection.text.slice(0, MAX_PREVIEW_CHARS) + '…'
    : selection.text

  return (
    <div
      ref={containerRef}
      style={{ left: clampedX, top: clampedY }}
      className="fixed z-[9999] w-[400px] rounded-lg border border-neutral-700 bg-neutral-900 shadow-2xl shadow-black/60"
      role="dialog"
      aria-label="Ask about highlighted text"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800">
        <div className="flex items-center gap-1.5 text-xs text-neutral-400">
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
