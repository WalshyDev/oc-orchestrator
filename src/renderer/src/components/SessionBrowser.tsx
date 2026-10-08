import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { X, FolderOpen, CaretDown, ClockCounterClockwise, CircleNotch, ChatCircleDots } from '@phosphor-icons/react'
import type { Project, SessionListEntry } from '../types/api'
import { PortaledMenu } from './PortaledMenu'
import { ProjectDirectoryOptions } from './ProjectDirectoryOptions'
import { recordRecentDirectory, removeRecentDirectory, useRecentDirectories } from '../hooks/useRecentDirectories'
import { matchesSessionSearch } from '../lib/session-browser'

interface KnownDirectory {
  name: string
  directory: string
  isWorktree?: boolean
}

interface SessionBrowserProps {
  onClose: () => void
  onResume: (directory: string, sessionId: string, title: string) => void
  onSelectDirectory: () => Promise<string | null>
  knownDirectories?: KnownDirectory[]
}

interface PromptPreview {
  text?: string
  error?: string
}

function previewText(preview?: PromptPreview): string {
  if (!preview) return 'Loading first prompt...'
  if (preview.error) return 'First prompt unavailable'
  return preview.text || 'No user text prompt'
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
  knownDirectories
}: SessionBrowserProps) {
  const [directory, setDirectory] = useState('')
  const [sessions, setSessions] = useState<SessionListEntry[]>([])
  const [homeDirectory, setHomeDirectory] = useState('')
  const [sessionSearch, setSessionSearch] = useState('')
  const [limit, setLimit] = useState(100)
  const [hasMore, setHasMore] = useState(false)
  const [previews, setPreviews] = useState<Record<string, PromptPreview>>({})
  const previewCache = useRef<Record<string, PromptPreview>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resuming, setResuming] = useState<string | null>(null)
  const [savedProjects, setSavedProjects] = useState<Project[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [projectSearch, setProjectSearch] = useState('')
  const recentDirectories = useRecentDirectories()
  const dropdownButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.getHomeDirectory().then((result) => {
      if (cancelled) return
      if (result.ok && result.data) {
        const home = result.data
        setHomeDirectory(home)
        setDirectory((current) => current || home)
      } else {
        setError(result.error ?? 'Could not find the home directory. Browse for a directory below.')
      }
    }).catch((err) => { if (!cancelled) setError(String(err)) })
    return () => { cancelled = true }
  }, [])

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
  }, [])

  useEffect(() => {
    if (!directory.trim()) return

    let cancelled = false
    const fetchSessions = async () => {
      setLoading(true)
      setError(null)
      setSessions([])
      setHasMore(false)
      setPreviews(previewCache.current)

      try {
        const result = await window.api.listSessions(directory.trim(), limit)
        if (cancelled) return

        if (result.ok && result.data) {
          const sorted = [...result.data.sessions].sort((a, b) => b.updatedAt - a.updatedAt)
          setSessions(sorted)
          setHasMore(result.data.hasMore)
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
  }, [directory, limit])

  useEffect(() => {
    let cancelled = false
    let next = 0
    const loadPreviews = async () => {
      while (!cancelled && next < sessions.length) {
        const session = sessions[next++]
        const cached = previewCache.current[session.id]
        if (cached) {
          setPreviews((current) => ({ ...current, [session.id]: cached }))
          continue
        }
        try {
          const result = await window.api.getSessionFirstPrompt(session.directory, session.id)
          const preview = result.ok
            ? { text: result.data ?? '' }
            : { error: result.error ?? 'Could not load first prompt' }
          previewCache.current = { ...previewCache.current, [session.id]: preview }
          if (cancelled) return
          setPreviews((current) => ({ ...current, [session.id]: preview }))
        } catch (err) {
          const preview = { error: String(err) }
          previewCache.current = { ...previewCache.current, [session.id]: preview }
          if (!cancelled) setPreviews((current) => ({ ...current, [session.id]: preview }))
        }
      }
    }
    for (let worker = 0; worker < Math.min(4, sessions.length); worker++) void loadPreviews()
    return () => { cancelled = true }
  }, [sessions])

  const filteredSessions = useMemo(() => sessions.filter((session) =>
    matchesSessionSearch(session, previews[session.id]?.text ?? '', sessionSearch)
  ), [sessions, previews, sessionSearch])
  const pendingPreviews = sessions.filter((session) => !previews[session.id]).length
  const failedPreviews = sessions.filter((session) => previews[session.id]?.error).length
  let emptyMessage = 'No sessions outside the fleet found in this directory.'
  if (pendingPreviews > 0) emptyMessage = 'Searching first prompts...'
  else if (sessions.length > 0) emptyMessage = 'No matching sessions.'

  // Outside-click handling is delegated to PortaledMenu's onDismiss.

  const handleBrowse = async () => {
    const selected = await onSelectDirectory()
    if (selected) {
      handleSelectProject(selected)
    }
  }

  const handleSelectProject = (repoRoot: string) => {
    setLimit(100)
    setSessionSearch('')
    setDirectory(repoRoot)
    setShowDropdown(false)
    setProjectSearch('')
  }

  const handleResume = useCallback(async (session: SessionListEntry) => {
    setResuming(session.id)
    try {
      await onResume(session.directory, session.id, session.title)
      recordRecentDirectory(directory)
      onClose()
    } catch (err) {
      setError(`Resume failed: ${String(err)}`)
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
      if (removed) removeRecentDirectory(removed.repo_root)
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
        className="w-[700px] max-w-[calc(100vw-2rem)] max-h-[85vh] bg-kumo-elevated border border-kumo-line rounded-xl shadow-2xl flex flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-kumo-line">
          <div className="flex items-center gap-2.5">
            <ClockCounterClockwise size={18} className="text-kumo-brand" />
            <h2 className="text-base font-semibold text-kumo-strong">Restore / Resume Session</h2>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md border border-kumo-line text-kumo-subtle hover:text-kumo-default hover:bg-kumo-fill transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 flex flex-col gap-4 min-h-0 flex-1">
          {/* Directory Selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-kumo-subtle uppercase tracking-wide">
              Session Directory
            </label>
            <p className="text-[11px] text-kumo-subtle -mt-0.5">
              Restore a session removed from the fleet. QuickStart sessions are in your home directory.
            </p>
            <div className="flex gap-2">
              <div className="flex-1 min-w-0">
                <button
                  ref={dropdownButtonRef}
                  type="button"
                  onClick={() => setShowDropdown(!showDropdown)}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-kumo-control border border-kumo-line rounded-md text-sm outline-none transition-colors hover:bg-kumo-fill focus:border-kumo-ring"
                >
                  <div className="min-w-0 flex-1 text-left truncate">
                    {hasDirectory ? (
                      <>
                        <span className="text-kumo-default font-medium">
                          {directory === homeDirectory ? 'Home / QuickStart' : selectedProject?.name || dirDisplayName(directory)}
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

                <PortaledMenu
                  open={showDropdown}
                  triggerRef={dropdownButtonRef}
                  placement="bottom-left"
                  matchTriggerWidth
                  onDismiss={() => { setShowDropdown(false); setProjectSearch('') }}
                  className="bg-kumo-control border border-kumo-fill-hover rounded-md shadow-2xl max-h-[240px] flex flex-col overflow-hidden"
                >
                  {(savedProjects.length > 0 || recentDirectories.length > 0) && (
                    <div className="px-2 pt-2 pb-1 shrink-0">
                      <input
                        type="text"
                        value={projectSearch}
                        onChange={(e) => setProjectSearch(e.target.value)}
                        placeholder="Search projects..."
                        className="w-full rounded border border-kumo-line bg-kumo-elevated px-2 py-1 text-xs text-kumo-default placeholder:text-kumo-subtle outline-none focus:border-kumo-ring"
                        autoFocus
                      />
                    </div>
                  )}
                  <div className="overflow-y-auto flex-1">
                    <ProjectDirectoryOptions
                      projects={savedProjects}
                      search={projectSearch}
                      homeDirectory={homeDirectory}
                      onSelect={handleSelectProject}
                      onRemove={(id, event) => void removeProject(id, event)}
                    />
                    {homeDirectory && (
                      <button
                        onMouseDown={() => handleSelectProject(homeDirectory)}
                        className="w-full px-3 py-2 text-left text-xs text-kumo-default hover:bg-kumo-fill-hover transition-colors"
                      >
                        Home / QuickStart
                      </button>
                    )}
                    <button
                      onMouseDown={() => void handleBrowse()}
                      className="w-full px-3 py-2 text-left text-xs text-kumo-default hover:bg-kumo-fill-hover transition-colors flex items-center gap-2"
                    >
                      <FolderOpen size={14} className="text-kumo-subtle" />
                      Browse for directory...
                    </button>
                  </div>
                </PortaledMenu>
              </div>
              <button
                onClick={handleBrowse}
                className="px-3 py-2 bg-kumo-control border border-kumo-line rounded-md text-kumo-subtle hover:text-kumo-default hover:bg-kumo-fill transition-colors"
              >
                <FolderOpen size={16} />
              </button>
            </div>
          </div>

          {/* Sessions List */}
          {hasDirectory && (
            <div className="flex flex-col gap-1.5 min-h-0 flex-1">
              <label className="text-xs font-medium text-kumo-subtle uppercase tracking-wide shrink-0">
                Available Sessions
              </label>
              <input
                aria-label="Search sessions"
                value={sessionSearch}
                onChange={(event) => setSessionSearch(event.target.value)}
                placeholder="Search title, first prompt, directory, or date (YYYY-MM-DD)..."
                className="w-full rounded-md border border-kumo-line bg-kumo-control px-3 py-2 text-xs text-kumo-default outline-none focus:border-kumo-ring"
              />
              <p className="text-[11px] text-kumo-subtle">
                Sessions already in the fleet are hidden. Search covers loaded sessions; load more to find older ones.
              </p>
              {!loading && pendingPreviews > 0 && (
                <p className="text-[11px] text-kumo-subtle">Loading first prompts for {pendingPreviews} sessions...</p>
              )}
              {!loading && failedPreviews > 0 && (
                <p className="text-[11px] text-kumo-danger">First prompt search is incomplete for {failedPreviews} sessions. You can still find them by title or date.</p>
              )}

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

              {!loading && filteredSessions.length === 0 && !error && (
                <p className="py-4 text-sm text-kumo-subtle text-center">
                  {emptyMessage}
                </p>
              )}

              {!loading && filteredSessions.length > 0 && (
                <div className="border border-kumo-line rounded-md overflow-y-auto min-h-0 flex-1">
                  {filteredSessions.map((session) => (
                    <div
                      key={session.id}
                      className="flex items-center gap-3 px-4 py-3 border-b border-kumo-line last:border-b-0 hover:bg-kumo-fill transition-colors group"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-kumo-default font-medium truncate">
                          {session.title}
                        </div>
                        <p className="text-xs text-kumo-subtle line-clamp-2 mt-1 whitespace-pre-wrap" title={previews[session.id]?.text ?? previews[session.id]?.error}>
                          {previewText(previews[session.id])}
                        </p>
                        <div className="text-[11px] text-kumo-subtle font-mono truncate mt-1" title={session.directory}>{session.directory}</div>
                        <div className="flex items-center gap-2 text-[11px] text-kumo-subtle mt-0.5">
                          <span>Updated {formatTimestamp(session.updatedAt)}</span>
                          <span className="text-kumo-line">|</span>
                          <span title={session.createdAt ? new Date(session.createdAt).toLocaleString() : undefined}>
                            Created {session.createdAt ? new Date(session.createdAt).toLocaleDateString() : 'unknown'}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => void handleResume(session)}
                        disabled={resuming !== null}
                        className="shrink-0 px-3 py-1.5 text-xs font-medium text-kumo-brand border border-kumo-brand/30 rounded-md hover:bg-kumo-brand/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {resuming === session.id ? (
                          <CircleNotch size={12} className="animate-spin" />
                        ) : (
                          'Restore'
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {!loading && hasMore && (
                <button
                  onClick={() => setLimit((current) => current + 100)}
                  disabled={resuming !== null}
                  className="px-3 py-2 text-xs text-kumo-brand border border-kumo-line rounded-md disabled:opacity-40"
                >
                  Load more sessions
                </button>
              )}
            </div>
          )}
          {!hasDirectory && error && <p className="text-sm text-kumo-danger">{error}</p>}
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
