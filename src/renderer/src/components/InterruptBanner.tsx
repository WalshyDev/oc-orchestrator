import type { Interrupt } from '../types'

interface InterruptBannerProps {
  interrupts: Interrupt[]
  onReviewAll: () => void
}

export function InterruptBanner({ interrupts, onReviewAll }: InterruptBannerProps) {
  if (interrupts.length === 0) return null

  const approvalCount = interrupts.filter((interrupt) => interrupt.kind === 'needs_approval').length
  const inputCount = interrupts.filter((interrupt) => interrupt.kind === 'needs_input').length
  const oldestTime = interrupts[0]?.createdAt ?? 'unknown'

  const parts: string[] = []
  if (approvalCount > 0) parts.push(`${approvalCount} need${approvalCount > 1 ? '' : 's'} approval`)
  if (inputCount > 0) parts.push(`${inputCount} need${inputCount > 1 ? '' : 's'} input`)

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-gradient-to-r from-kumo-danger/8 to-kumo-danger/3 border-b border-kumo-danger/20 shrink-0">
      <div className="w-5 h-5 rounded-full bg-kumo-danger/15 flex items-center justify-center text-kumo-danger text-[11px] font-bold shrink-0">
        {interrupts.length}
      </div>
      <div className="flex-1 text-xs text-kumo-default">
        <strong className="text-kumo-danger">{interrupts.length} agents blocked</strong>
        {' \u2014 '}
        {parts.join(', ')}
        {' \u00B7 oldest blocked '}
        <strong className="text-kumo-danger">{oldestTime}</strong>
      </div>
      <button
        onClick={onReviewAll}
        className="px-2.5 py-1 text-[11px] font-medium bg-kumo-danger/15 text-kumo-danger border border-kumo-danger/25 rounded-md hover:bg-kumo-danger/25 transition-colors"
      >
        Review All &rarr;
      </button>
    </div>
  )
}
