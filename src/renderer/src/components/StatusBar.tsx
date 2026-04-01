interface StatusBarProps {
  agentCount: number
  projectCount: number
  healthy: boolean
  version?: string
}

export function StatusBar({ agentCount, projectCount, healthy, version }: StatusBarProps) {
  return (
    <div className="flex items-center justify-between px-4 h-7 bg-kumo-elevated border-t border-kumo-line text-[11px] text-kumo-subtle shrink-0">
      <div className="flex items-center gap-3">
        <span className={`w-1.5 h-1.5 rounded-full ${healthy ? 'bg-kumo-success' : 'bg-kumo-danger'}`} />
        <span>{healthy ? 'All runtimes healthy' : 'Some runtimes unhealthy'}</span>
        <span>&middot;</span>
        <span>{agentCount} agents across {projectCount} projects</span>
        {version && (
          <>
            <span>&middot;</span>
            <span>v{version}</span>
          </>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span>
          <kbd className="font-mono text-[10px] px-1 py-px bg-kumo-fill rounded border border-kumo-line">J</kbd>
          <kbd className="font-mono text-[10px] px-1 py-px bg-kumo-fill rounded border border-kumo-line ml-0.5">K</kbd>
          {' '}navigate
        </span>
        <span>
          <kbd className="font-mono text-[10px] px-1 py-px bg-kumo-fill rounded border border-kumo-line">Enter</kbd>
          {' '}open
        </span>
        <span>
          <kbd className="font-mono text-[10px] px-1 py-px bg-kumo-fill rounded border border-kumo-line">N</kbd>
          {' '}next urgent
        </span>
      </div>
    </div>
  )
}
