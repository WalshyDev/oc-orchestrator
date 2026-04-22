/**
 * Thresholds for the context-usage color ramp, ordered highest → lowest. The
 * first entry whose `minPct` the current usage meets wins. Exposed as a table
 * rather than an if/else chain so the breakpoints are easy to tune.
 *
 * Each entry carries both a text tone and a matching background tone so the
 * bar variant and the text variants stay visually consistent.
 */
const CONTEXT_USAGE_TONES: ReadonlyArray<{ minPct: number; text: string; bar: string }> = [
  { minPct: 95, text: 'text-kumo-danger',        bar: 'bg-kumo-danger' },        // compact now
  { minPct: 80, text: 'text-status-warning',     bar: 'bg-status-warning' },     // compact soon
  { minPct: 60, text: 'text-status-warning/80',  bar: 'bg-status-warning/80' },  // worth noticing
  { minPct: 0,  text: 'text-kumo-subtle',        bar: 'bg-kumo-subtle' }         // plenty of room
]

function formatTokenCount(n: number): string {
  return n >= 10_000 ? `${Math.round(n / 1000)}k` : `${n}`
}

interface ContextUsageIndicatorProps {
  used?: number
  limit?: number
  /** Display variant.
   *  - 'full': `73k/200k (37%)` text
   *  - 'compact': `37%` text
   *  - 'bar': horizontal progress bar with percentage underneath */
  variant?: 'full' | 'compact' | 'bar'
}

/**
 * Compact display of context-window usage. Hidden when we don't have enough
 * data to compute (e.g. no assistant messages yet).
 */
export function ContextUsageIndicator({ used, limit, variant = 'full' }: ContextUsageIndicatorProps) {
  if (typeof used !== 'number' || typeof limit !== 'number' || limit <= 0) return null

  const pct = Math.min(100, Math.round((used / limit) * 100))
  const tones = CONTEXT_USAGE_TONES.find((t) => pct >= t.minPct) ?? CONTEXT_USAGE_TONES[CONTEXT_USAGE_TONES.length - 1]
  const title = `${used.toLocaleString()} / ${limit.toLocaleString()} tokens in context (${pct}%)`

  if (variant === 'bar') {
    return (
      <div className="flex flex-col items-stretch gap-0.5 w-full" title={title}>
        <div className="h-1 rounded-sm bg-kumo-fill overflow-hidden">
          <div className={`h-full ${tones.bar} transition-all`} style={{ width: `${pct}%` }} />
        </div>
        <span className={`text-[10px] font-mono ${tones.text}`}>{pct}%</span>
      </div>
    )
  }

  const label = variant === 'compact'
    ? `${pct}%`
    : `${formatTokenCount(used)}/${formatTokenCount(limit)} (${pct}%)`

  return (
    <span className={`text-[10px] font-mono whitespace-nowrap ${tones.text}`} title={title}>
      {label}
    </span>
  )
}
