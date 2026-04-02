import { useState, useEffect, useCallback, useRef } from 'react'
import { X, FolderOpen, CaretDown, Trash, ClockCounterClockwise, CircleNotch, ChatCircleDots } from '@phosphor-icons/react'
import type { Project } from '../types/api'

interface SessionInfo {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

interface KnownDirectory {
  name: string
  directory: string
  isWorktree?: boolean
}

interface SessionBrowserProps {
  onClose: () => void
  onResume: (directory: string, sessionId: string, title: string) => void
  onSelectDirectory: () => Promise<string | null>
  onValidateDirectory?: (dir: string) => Promise<boolean>
  knownDirectories?: KnownDirectory[]
}

function dirDisplayName(path: string): string {
  const parts = path.replace(/\/$/, '').split('/').filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : path
}

function formatTimestamp(ms: number): string {
  if (!ms) return 'unknown'
  const date = new Date(ms)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60_000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

export function SessionBrowser({
  onClose,
  onResume,
  onSelectDirectory,
  onValidateDirectory,
  knownDirectories
}: SessionBrowserProps) {
  const [directory, setDirectory] = useState('')
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resuming, setResuming] = useState<string | null>(null)
  const [savedProjects, setSavedProjects] = useState<Project[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [validating, setValidating] = useState(false)
  const [dirError, setDirError] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Load saved projects
  useEffect(() => {
    const loadProjects = async () => {
      try {
        const result = await window.api.listProjects()
        if (result.ok && result.data) {
          setSavedProjects(result.data)
        }
      } catch {
        // ignore
      }
    }

    // Seed saved projects from existing agent directories
    const seedFromAgents = async () => {
      if (!knownDirectories || knownDirectories.length === 0) {
        await loadProjects()
        return
      }

      const seen = new Set<string>()
      for (const known of knownDirectories) {
        try {
          let dir = known.directory
          if (known.isWorktree) {
            const result = await window.api.getCommonRepoRoot(known.directory)
            if (result.ok && result.data) {
              dir = result.data
            } else {
              continue
            }
          }
          if (seen.has(dir)) continue
          seen.add(dir)
          await window.api.ensureProject({ name: known.name, repoRoot: dir })
        } catch {
          // ignore
        }
      }
      await loadProjects()
    }

    void seedFromAgents()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Validate directory
  useEffect(() => {
    if (!directory.trim()) {
      setDirError(null)
      setValidating(false)
      return
    }

    const currentDir = directory.trim()
    setValidating(true)

    const timer = setTimeout(async () => {
      if (onValidateDirectory) {
        try {
          const isValid = await onValidateDirectory(currentDir)
          setDirectory((latest) => {
            if (latest.trim() === currentDir) {
              setDirError(isValid ? null : 'This directory is not a valid git repository.')
              setValidating(false)
            }
            return latest
          })
        } catch {
          setDirectory((latest) => {
            if (latest.trim() === currentDir) {
              setDirError('Could not validate directory.')
              setValidating(false)
            }
            return latest
          })
        }
      } else {
        setValidating(false)
      }
    }, 500)

    return () => clearTimeout(timer)
  }, [directory, onValidateDirectory])

  // Fetch sessions when directory changes and is valid
  useEffect(() => {
    if (!directory.trim() || dirError || validating) {
      setSessions([])
      setError(null)
      return
    }

    let cancelled = false
    const fetchSessions = async () => {
      setLoading(true)
      setError(null)
      setSessions([])

      try {
        const result = await window.api.listSessions(directory.trim())
        if (cancelled) return

        if (result.ok && result.data) {
          const sorted = [...result.data].sort((a, b) => b.updatedAt - a.updatedAt)
          setSessions(sorted)
          if (sorted.length === 0) {
            setError('No existing sessions found in this directory.')
          }
        } else {
          setError(result.error ?? 'Failed to list sessions.')
        }
      } catch (err) {
        if (!cancelled) {
          setError(String(err))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void fetchSessions()
    return () => { cancelled = true }
  }, [directory, dirError, validating])

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleBrowse = async () => {
    const selected = await onSelectDirectory()
    if (selected) {
      setDirectory(selected)
      setShowDropdown(false)
    }
  }

  const handleSelectProject = (repoRoot: string) => {
    setDirectory(repoRoot)
    setShowDropdown(false)
  }

  const handleResume = useCallback(async (session: SessionInfo) => {
    setResuming(session.id)
    try {
      await onResume(directory.trim(), session.id, session.title)
      onClose()
    } catch (err) {
      console.error('Resume failed:', err)
      setResuming(null)
    }
  }, [directory, onResume, onClose])

  const removeProject = useCallback(async (projectId: string, event: React.MouseEvent) => {
    event.stopPropagation()
    event.preventDefault()
    try {
      await window.api.deleteProject(projectId)
      setSavedProjects((prev) => prev.filter((p) => p.id !== projectId))
      const removed = savedProjects.find((p) => p.id === projectId)
      if (removed && removed.repo_root === directory) {
        setDirectory('')
      }
    } catch {
      // ignore
    }
  }, [directory, savedProjects])

  const selectedProject = savedProjects.find((p) => p.repo_root === directory)
  const hasDirectory = directory.trim().length > 0

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[560px] max-h-[85vh] bg-kumo-elevated border border-kumo-line rounded-xl shadow-2xl flex flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-kumo-line">
          <div className="flex items-center gap-2.5">
            <ClockCounterClockwise size={18} className="text-kumo-brand" />
            <h2 className="text-base font-semibold text-kumo-strong">Resume Session</h2>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md border border-kumo-line text-kumo-subtle hover:text-kumo-default hover:bg-kumo-fill transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 flex flex-col gap-4 overflow-y-auto overflow-x-hidden">
          {/* Directory Selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-kumo-subtle uppercase tracking-wide">
              Project Directory
            </label>
            <p className="text-[11px] text-kumo-subtle -mt-0.5">
              Select the original project directory (not a worktree) to browse its sessions.
            </p>
            <div className="relative flex gap-2" ref={dropdownRef}>
              <div className="flex-1 min-w-0 relative">
                <button
                  type="button"
                  onClick={() => setShowDropdown(!showDropdown)}
                  className={`w-full flex items-center gap-2 px-3 py-2 bg-kumo-control border rounded-md text-sm outline-none transition-colors hover:bg-kumo-fill focus:border-kumo-ring ${
                    dirError ? 'border-kumo-danger' : 'border-kumo-line'
                  }`}
                >
                  <div className="min-w-0 flex-1 text-left truncate">
                    {hasDirectory ? (
                      <>
                        <span className="text-kumo-default font-medium">
                          {selectedProject?.name || dirDisplayName(directory)}
                        </span>
                        <span className="text-kumo-subtle font-mono text-xs ml-2">
                          {directory}
                        </span>
                      </>
                    ) : (
                      <span className="text-kumo-subtle">Select a project directory...</span>
                    )}
                  </div>
                  <CaretDown size={14} className="text-kumo-subtle shrink-0" />
                </button>

                {showDropdown && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-kumo-control border border-kumo-fill-hover rounded-md shadow-2xl z-10 max-h-[240px] overflow-y-auto overflow-x-hidden">
                    {savedProjects.length > 0 && (
                      <>
                        <div className="px-3 py-1.5 text-[10px] font-medium text-kumo-subtle uppercase tracking-wider">
                          Saved Projects
                        </div>
                        {savedProjects.map((project) => (
                          <div
                            key={project.id}
                            className="group flex items-center px-3 py-1.5 hover:bg-kumo-fill-hover transition-colors cursor-pointer"
                            onMouseDown={() => handleSelectProject(project.repo_root)}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="text-xs text-kumo-default font-medium truncate">
                                {project.name}
                              </div>
                              <div className="text-[11px] text-kumo-subtle font-mono truncate">
                                {project.repo_root}
                              </div>
                            </div>
                            <button
                              onMouseDown={(e) => void removeProject(project.id, e)}
                              className="ml-2 p-1 rounded text-kumo-subtle/0 group-hover:text-kumo-subtle hover:!text-kumo-danger hover:bg-kumo-fill-hover transition-colors shrink-0"
                              title="Remove from saved projects"
                            >
                              <Trash size={12} />
                            </button>
                          </div>
                        ))}
                        <div className="border-t border-kumo-fill-hover" />
                      </>
                    )}
                    <button
                      onMouseDown={() => void handleBrowse()}
                      className="w-full px-3 py-2 text-left text-xs text-kumo-default hover:bg-kumo-fill-hover transition-colors flex items-center gap-2"
                    >
                      <FolderOpen size={14} className="text-kumo-subtle" />
                      Browse for directory...
                    </button>
                  </div>
                )}
              </div>
              <button
                onClick={handleBrowse}
                className="px-3 py-2 bg-kumo-control border border-kumo-line rounded-md text-kumo-subtle hover:text-kumo-default hover:bg-kumo-fill transition-colors"
              >
                <FolderOpen size={16} />
              </button>
            </div>
            {validating && (
              <p className="text-[11px] text-kumo-subtle">Validating directory...</p>
            )}
            {dirError && (
              <p className="text-[11px] text-kumo-danger">{dirError}</p>
            )}
          </div>

          {/* Sessions List */}
          {hasDirectory && !dirError && !validating && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-kumo-subtle uppercase tracking-wide">
                Available Sessions
              </label>

              {loading && (
                <div className="flex items-center gap-2 py-6 justify-center text-sm text-kumo-subtle">
                  <CircleNotch size={16} className="animate-spin" />
                  Loading sessions...
                </div>
              )}

              {!loading && error && (
                <div className="flex items-center gap-2 py-6 justify-center text-sm text-kumo-subtle">
                  <ChatCircleDots size={16} />
                  {error}
                </div>
              )}

              {!loading && !error && sessions.length > 0 && (
                <div className="border border-kumo-line rounded-md overflow-hidden max-h-[300px] overflow-y-auto">
                  {sessions.map((session) => (
                    <div
                      key={session.id}
                      className="flex items-center gap-3 px-3 py-2.5 border-b border-kumo-line last:border-b-0 hover:bg-kumo-fill transition-colors group"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-kumo-default font-medium truncate">
                          {session.title}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-kumo-subtle">
                          <span>Updated {formatTimestamp(session.updatedAt)}</span>
                          <span className="text-kumo-line">|</span>
                          <span className="font-mono truncate">{session.id.slice(0, 12)}...</span>
                        </div>
                      </div>
                      <button
                        onClick={() => void handleResume(session)}
                        disabled={resuming !== null}
                        className="shrink-0 px-3 py-1.5 text-xs font-medium text-kumo-brand border border-kumo-brand/30 rounded-md hover:bg-kumo-brand/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed opacity-0 group-hover:opacity-100 focus:opacity-100"
                      >
                        {resuming === session.id ? (
                          <CircleNotch size={12} className="animate-spin" />
                        ) : (
                          'Resume'
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-kumo-line">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-kumo-subtle border border-kumo-line rounded-md hover:bg-kumo-fill transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
