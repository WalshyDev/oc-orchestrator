import { CircleNotch } from '@phosphor-icons/react'
import type { ChildTranscriptEntry, DisplayToolState } from '../lib/subagent-progress'

interface SubagentProgressProps {
  entries: ChildTranscriptEntry[]
  state: DisplayToolState
  childSessionId?: string
}

function toolIconStyle(toolState: DisplayToolState | undefined): string {
  if (toolState === 'failed') return 'text-kumo-danger'
  if (toolState === 'completed') return 'text-kumo-success'
  return 'text-kumo-link'
}

function progressLabel(state: DisplayToolState, childSessionId: string | undefined): string {
  if (state === 'failed') return 'sub-agent failed'
  if (state === 'completed') return 'sub-agent transcript'
  return childSessionId ? 'sub-agent working' : 'sub-agent starting'
}

function emptyProgressMessage(state: DisplayToolState, childSessionId: string | undefined): string {
  if (state === 'failed') {
    return childSessionId ? 'Sub-agent stopped without output.' : 'Child session was not created.'
  }
  if (state === 'completed') return 'No sub-agent output was recorded.'
  return childSessionId ? 'Waiting for live output...' : 'Creating child session...'
}

export function SubagentProgress({ entries, state, childSessionId }: SubagentProgressProps) {
  const running = state === 'running'

  return (
    <div className="mt-2 rounded-md border border-kumo-line bg-kumo-overlay px-2 py-1.5">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-kumo-subtle">
        {running && <CircleNotch size={10} className="animate-spin text-kumo-link" />}
        <span>{progressLabel(state, childSessionId)}</span>
      </div>
      {entries.length === 0 ? (
        <div className="text-[10px] font-mono text-kumo-subtle">
          {emptyProgressMessage(state, childSessionId)}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {entries.map((entry) => (
            <div key={entry.id} className="text-[10px] font-mono leading-tight">
              {entry.kind === 'text' ? (
                <div className="whitespace-pre-wrap break-words text-kumo-default">
                  {entry.label}
                </div>
              ) : (
                <div>
                  <div className="flex items-start gap-1.5 text-kumo-subtle">
                    <span className={`shrink-0 ${toolIconStyle(entry.toolState)}`}>
                      {entry.toolState === 'completed' ? '✓' : entry.toolState === 'failed' ? '✗' : '...'}
                    </span>
                    <span className="text-kumo-link">{entry.label}</span>
                    {entry.toolSummary && (
                      <span className="truncate text-kumo-subtle">{entry.toolSummary}</span>
                    )}
                  </div>
                  {entry.toolOutput && (
                    <pre className="mt-1 max-h-[160px] overflow-auto whitespace-pre-wrap break-all rounded bg-kumo-control px-2 py-1 text-kumo-subtle">
                      {entry.toolOutput}
                    </pre>
                  )}
                  {entry.label === 'task' && (entry.toolState === 'running' || entry.childTranscript?.length) && (
                    <SubagentProgress
                      entries={entry.childTranscript ?? []}
                      state={entry.toolState ?? 'running'}
                      childSessionId={entry.childSessionId}
                    />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
