import { Trash } from '@phosphor-icons/react'
import { removeRecentDirectory, useRecentDirectories } from '../hooks/useRecentDirectories'
import type { Project } from '../types/api'

interface ProjectDirectoryOptionsProps {
  projects: Project[]
  search: string
  homeDirectory: string
  onSelect: (directory: string) => void
  onRemove: (projectId: string, event: React.MouseEvent) => void
}

export function ProjectDirectoryOptions({ projects, search, homeDirectory, onSelect, onRemove }: ProjectDirectoryOptionsProps) {
  const recentDirectories = useRecentDirectories()
  const recent = recentDirectories.map((directory) => {
    const project = projects.find((entry) => entry.repo_root === directory)
    const name = directory === homeDirectory
      ? 'Home / QuickStart'
      : project?.name || directory.replace(/\/$/, '').split('/').pop() || directory
    return { directory, name, project }
  })
  const saved = projects.filter((project) => !recentDirectories.includes(project.repo_root))
    .map((project) => ({ directory: project.repo_root, name: project.name, project }))
  const query = search.trim().toLowerCase()
  const groups = [
    { title: 'Recently Used', entries: recent },
    { title: 'Saved Projects', entries: saved }
  ].map((group) => ({ ...group, entries: group.entries.filter((entry) =>
    entry.name.toLowerCase().includes(query) || entry.directory.toLowerCase().includes(query)
  ) }))

  return (
    <>
      {groups.map((group) => group.entries.length > 0 && (
        <div key={group.title}>
          <div className="px-3 py-1.5 text-[10px] font-medium text-kumo-subtle uppercase tracking-wider">
            {group.title}
          </div>
          {group.entries.map((entry) => (
            <div
              key={entry.directory}
              className="group flex items-center px-3 py-1.5 hover:bg-kumo-fill-hover transition-colors"
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onMouseDown={() => onSelect(entry.directory)}
              >
                <div className="text-xs text-kumo-default font-medium truncate">{entry.name}</div>
                <div className="text-[11px] text-kumo-subtle font-mono truncate">{entry.directory}</div>
              </button>
              <button
                type="button"
                onMouseDown={(event) => {
                  if (entry.project) {
                    onRemove(entry.project.id, event)
                  } else {
                    event.preventDefault()
                    removeRecentDirectory(entry.directory)
                  }
                }}
                className="ml-2 p-1 rounded text-kumo-subtle/0 group-hover:text-kumo-subtle hover:!text-kumo-danger hover:bg-kumo-fill-hover transition-colors shrink-0"
                title={entry.project ? 'Remove from saved projects' : 'Remove from recent directories'}
              >
                <Trash size={12} />
              </button>
            </div>
          ))}
          <div className="border-t border-kumo-fill-hover" />
        </div>
      ))}
      {query && groups.every((group) => group.entries.length === 0) && (
        <div className="px-3 py-4 text-xs text-kumo-subtle text-center">No matching projects</div>
      )}
    </>
  )
}
