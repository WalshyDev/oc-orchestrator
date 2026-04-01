import { Command, GearSix, Plus } from '@phosphor-icons/react'

interface TopBarProps {
  runningCount: number
  blockedCount: number
  idleCount: number
  onLaunch: () => void
  onOpenCommandPalette?: () => void
  onSettings?: () => void
}

export function TopBar({
  runningCount,
  blockedCount,
  idleCount,
  onLaunch,
  onOpenCommandPalette,
  onSettings,
}: TopBarProps) {
  return (
    <div className="drag-region flex items-center justify-between h-12 pl-20 pr-4 bg-kumo-elevated border-b border-kumo-line shrink-0">
      {/* Left: Logo — pl-20 clears macOS traffic light buttons */}
      <div className="no-drag flex items-center gap-3">
        <div className="flex items-center gap-2">
          <img src="/favicon.svg" alt="" className="w-5 h-5" />
          <span className="font-bold text-sm text-kumo-strong">OC Orchestrator</span>
        </div>
      </div>

      {/* Center: Fleet Stats */}
      <div className="no-drag flex items-center gap-1.5">
        <StatChip dotColor="bg-kumo-success" count={runningCount} label="running" />
        <StatChip dotColor="bg-kumo-danger" count={blockedCount} label="blocked" pulseDot />
        <StatChip dotColor="bg-kumo-warning" count={idleCount} label="idle" />
      </div>

      {/* Right: Actions */}
      <div className="no-drag flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenCommandPalette}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-kumo-line text-kumo-subtle text-xs hover:bg-kumo-fill hover:text-kumo-default transition-colors"
          title="Open command palette"
        >
          <kbd className="font-mono text-[10px] px-1 py-px bg-kumo-fill rounded border border-kumo-line">
            <Command size={10} className="inline" />K
          </kbd>
          <span>Command</span>
        </button>
        {onSettings && (
          <button
            type="button"
            onClick={onSettings}
            className="flex items-center justify-center w-8 h-8 rounded-md border border-kumo-line text-kumo-subtle hover:bg-kumo-fill hover:text-kumo-default transition-colors"
            title="Settings"
          >
            <GearSix size={16} />
          </button>
        )}
        <button
          type="button"
          onClick={onLaunch}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-kumo-brand text-white text-xs font-medium hover:bg-kumo-brand-hover transition-colors"
        >
          <Plus size={14} weight="bold" />
          Launch Agent
        </button>
      </div>
    </div>
  )
}

function StatChip({
  dotColor,
  count,
  label,
  pulseDot = false
}: {
  dotColor: string
  count: number
  label: string
  pulseDot?: boolean
}) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 bg-kumo-control rounded-full text-xs font-medium text-kumo-subtle">
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor} ${pulseDot ? 'animate-pulse-dot' : ''}`} />
      <span className="font-mono font-semibold text-kumo-default">{count}</span>
      <span>{label}</span>
    </div>
  )
}
