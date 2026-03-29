import { File, FilePlus, FileMinus, PencilSimple } from '@phosphor-icons/react'

export interface FileChange {
  path: string
  action: 'created' | 'modified' | 'deleted'
  timestamp: number
}

interface FilesChangedProps {
  files: FileChange[]
}

const actionStyles: Record<FileChange['action'], string> = {
  created: 'bg-kumo-success/12 text-kumo-success border-kumo-success/25',
  modified: 'bg-status-idle-bg text-status-idle border-status-idle/25',
  deleted: 'bg-kumo-danger/10 text-kumo-danger border-kumo-danger/20'
}

const actionLabels: Record<FileChange['action'], string> = {
  created: 'Created',
  modified: 'Modified',
  deleted: 'Deleted'
}

function actionIcon(action: FileChange['action']) {
  switch (action) {
    case 'created':
      return <FilePlus size={14} weight="duotone" />
    case 'modified':
      return <PencilSimple size={14} />
    case 'deleted':
      return <FileMinus size={14} weight="duotone" />
  }
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function extractFilename(filePath: string): string {
  const segments = filePath.split('/')
  return segments[segments.length - 1] || filePath
}

export function FilesChanged({ files }: FilesChangedProps) {
  const latestByPath = new Map<string, FileChange>()
  for (const file of files) {
    const existingFile = latestByPath.get(file.path)
    if (!existingFile || existingFile.timestamp < file.timestamp) {
      latestByPath.set(file.path, file)
    }
  }

  const dedupedFiles = Array.from(latestByPath.values())

  if (dedupedFiles.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-kumo-subtle py-12">
        <File size={28} weight="duotone" />
        <span className="text-sm">No files changed yet</span>
      </div>
    )
  }

  const sorted = dedupedFiles.sort((fileA, fileB) => fileB.timestamp - fileA.timestamp)

  return (
    <div className="flex flex-col gap-1 py-2">
      <div className="text-[11px] text-kumo-subtle px-1 pb-1">
        {dedupedFiles.length} file{dedupedFiles.length !== 1 ? 's' : ''} changed
      </div>
      {sorted.map((file, index) => (
        <div
          key={`${file.path}-${index}`}
          className="flex items-center gap-2.5 px-2.5 py-2 rounded-md bg-kumo-control border border-kumo-line hover:border-kumo-fill-hover transition-colors group"
        >
          <span className={`shrink-0 ${actionStyles[file.action].split(' ').find((cls) => cls.startsWith('text-'))}`}>
            {actionIcon(file.action)}
          </span>

          <div className="flex-1 min-w-0">
            <div
              className="text-xs text-kumo-default truncate"
              title={file.path}
            >
              {extractFilename(file.path)}
            </div>
            <div className="text-[10px] text-kumo-subtle truncate" title={file.path}>
              {file.path}
            </div>
          </div>

          <span
            className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${actionStyles[file.action]}`}
          >
            {actionLabels[file.action]}
          </span>

          <span className="shrink-0 text-[10px] text-kumo-subtle font-mono">
            {formatRelativeTime(file.timestamp)}
          </span>
        </div>
      ))}
    </div>
  )
}
