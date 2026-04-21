/**
 * Thresholds for the context-usage color ramp, ordered highest → lowest. The
 * first entry whose `minPct` the current usage meets wins. Exposed as a table
 * rather than an if/else chain so the breakpoints are easy to tune.
 */
const CONTEXT_USAGE_TONES: ReadonlyArray<{ minPct: number; tone: string }> = [
  { minPct: 95, tone: 'text-kumo-danger' },       // compact now
  { minPct: 80, tone: 'text-status-warning' },    // compact soon
  { minPct: 60, tone: 'text-status-warning/80' }, // worth noticing
  { minPct: 0,  tone: 'text-kumo-subtle' }        // plenty of room
]

function formatTokenCount(n: number): string {
  return n >= 10_000 ? `${Math.round(n / 1000)}k` : `${n}`
}

interface ContextUsageIndicatorProps {
  used?: number
  limit?: number
  /** Display variant. 'full' shows `73k/200k (37%)`; 'compact' shows just the
   *  percentage (useful in narrow table columns). */
  variant?: 'full' | 'compact'
}

/**
 * Compact display of context-window usage. Hidden when we don't have enough
 * data to compute (e.g. no assistant messages yet).
 */
export function ContextUsageIndicator({ used, limit, variant = 'full' }: ContextUsageIndicatorProps) {
  if (typeof used !== 'number' || typeof limit !== 'number' || limit <= 0) return null

  const pct = Math.min(100, Math.round((used / limit) * 100))
  const tone = CONTEXT_USAGE_TONES.find((t) => pct >= t.minPct)?.tone ?? 'text-kumo-subtle'
  const title = `${used.toLocaleString()} / ${limit.toLocaleString()} tokens in context (${pct}%)`

  const label = variant === 'compact'
    ? `${pct}%`
    : `${formatTokenCount(used)}/${formatTokenCount(limit)} (${pct}%)`

  return (
    <span className={`text-[10px] font-mono whitespace-nowrap ${tone}`} title={title}>
      {label}
    </span>
  )
}
