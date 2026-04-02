import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { X, FolderOpen, CaretDown, Warning, Trash } from '@phosphor-icons/react'
import { SelectField } from './SelectField'
import { useModelOptions } from '../hooks/useModelOptions'
import { loadSettings } from '../data/settings'
import type { Project } from '../types/api'

type WorktreeStrategy = 'new-worktree' | 'current-directory'

function sanitizePathSegment(value: string, fallback: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  return sanitized || fallback
}

function computeWorktreePath(worktreeRoot: string, directory: string, title: string): string {
  if (!worktreeRoot || !directory) return ''

  const directoryParts = directory.replace(/\/$/, '').split('/').filter(Boolean)
  const projectName = directoryParts.length > 0 ? directoryParts[directoryParts.length - 1] : 'project'
  const projectSlug = sanitizePathSegment(projectName, 'project')
  const taskSlug = sanitizePathSegment(title || 'agent', 'agent')

  return `${worktreeRoot}/${projectSlug}/${taskSlug}-<timestamp>`
}

function dirDisplayName(path: string): string {
  const parts = path.replace(/\/$/, '').split('/').filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : path
}

interface KnownDirectory {
  name: string
  directory: string
  isWorktree?: boolean
}

interface LaunchModalProps {
  onClose: () => void
  onLaunch: (directory: string, prompt?: string, title?: string, model?: string, worktreeStrategy?: string) => void
  onSelectDirectory: () => Promise<string | null>
  onValidateDirectory?: (dir: string) => Promise<boolean>
  knownDirectories?: KnownDirectory[]
}

export function LaunchModal({ onClose, onLaunch, onSelectDirectory, onValidateDirectory, knownDirectories }: LaunchModalProps) {
  const [directory, setDirectory] = useState('')
  const [prompt, setPrompt] = useState('')
  const [title, setTitle] = useState('')
  const [model, setModel] = useState(() => loadSettings().model)
  const { options: modelOptions } = useModelOptions()
  const [worktreeStrategy, setWorktreeStrategy] = useState<WorktreeStrategy>('new-worktree')
  const [launching, setLaunching] = useState(false)
  const [dirError, setDirError] = useState<string | null>(null)
  const [validating, setValidating] = useState(false)
  const [worktreeRoot, setWorktreeRoot] = useState('')
  const [savedProjects, setSavedProjects] = useState<Project[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const estimatedWorktreePath = useMemo(() => {
    if (worktreeStrategy !== 'new-worktree') return ''
    return computeWorktreePath(worktreeRoot, directory, title)
  }, [directory, title, worktreeRoot, worktreeStrategy])

  const loadProjects = useCallback(async () => {
    try {
      const result = await window.api.listProjects()
      if (result.ok && result.data) {
        setSavedProjects(result.data)
      }
    } catch {
      // ignore
    }
  }, [])

  const saveProject = useCallback(async (dir: string) => {
    const name = dirDisplayName(dir)
    try {
      await window.api.ensureProject({ name, repoRoot: dir })
      await loadProjects()
    } catch {
      // ignore save failures
    }
  }, [loadProjects])

  // Seed saved projects from existing agent directories
  useEffect(() => {
    if (!knownDirectories || knownDirectories.length === 0) return

    const seedFromAgents = async () => {
      const seen = new Set<string>()

      for (const known of knownDirectories) {
        try {
          let dir = known.directory
          // For worktree agents, resolve back to the actual repo root
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

  const removeProject = useCallback(async (projectId: string, event: React.MouseEvent) => {
    event.stopPropagation()
    event.preventDefault()
    try {
      await window.api.deleteProject(projectId)
      setSavedProjects((prev) => prev.filter((p) => p.id !== projectId))
      // If the removed project was selected, clear the directory
      const removed = savedProjects.find((p) => p.id === projectId)
      if (removed && removed.repo_root === directory) {
        setDirectory('')
      }
    } catch {
      // ignore
    }
  }, [directory, savedProjects])

  useEffect(() => {
    void loadProjects()
  }, [loadProjects])

  useEffect(() => {
    let isMounted = true

    const loadWorktreeRoot = async () => {
      try {
        const result = await window.api.getWorktreeRoot()
        if (isMounted && result.ok && result.data) {
          setWorktreeRoot(result.data)
        }
      } catch {
        // ignore preview path failures
      }
    }

    void loadWorktreeRoot()

    return () => {
      isMounted = false
    }
  }, [])

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
          // Only update state if the directory hasn't changed since we started
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

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleLaunch = async () => {
    if (!directory.trim() || dirError || validating) return
    setLaunching(true)
    try {
      await onLaunch(directory, prompt || undefined, title || undefined, model, worktreeStrategy)
      await saveProject(directory.trim())
      onClose()
    } catch (error) {
      console.error('Launch failed:', error)
      setLaunching(false)
    }
  }

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

  const selectButtonClasses =
    'flex w-full items-center justify-between gap-3 rounded-md border border-kumo-line bg-kumo-control px-3 py-2 text-sm text-kumo-default outline-none transition-colors hover:bg-kumo-fill focus:border-kumo-ring'

  const selectMenuClasses =
    'absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-kumo-line bg-kumo-overlay shadow-xl'

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
          <h2 className="text-base font-semibold text-kumo-strong">Launch New Agent</h2>
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
            <div className="relative flex gap-2" ref={dropdownRef}>
              <div className="flex-1 min-w-0 relative">
                {/* Selector button */}
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

                {/* Dropdown */}
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
              <p className="text-[11px] text-kumo-danger flex items-center gap-1">
                <Warning size={12} />
                {dirError}
              </p>
            )}
          </div>

          {/* Branch / Worktree Strategy */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-kumo-subtle uppercase tracking-wide">
              Branch Strategy
            </label>
            <div className="relative">
              <SelectField
                value={worktreeStrategy}
                onChange={(value) => setWorktreeStrategy(value as WorktreeStrategy)}
                options={[
                  { value: 'new-worktree', label: 'New Worktree (recommended)' },
                  { value: 'current-directory', label: 'Use Current Directory' }
                ]}
                buttonClassName={selectButtonClasses}
                menuClassName={selectMenuClasses}
              />
            </div>
            {worktreeStrategy === 'new-worktree' && estimatedWorktreePath && (
              <p className="text-[11px] text-kumo-subtle font-mono truncate" title={estimatedWorktreePath}>
                Worktree path: {estimatedWorktreePath}
              </p>
            )}
          </div>

          {/* Model */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-kumo-subtle uppercase tracking-wide">Model</label>
            <div className="relative">
              <SelectField
                value={model}
                onChange={(value) => setModel(value)}
                options={modelOptions}
                buttonClassName={selectButtonClasses}
                menuClassName={selectMenuClasses}
              />
            </div>
          </div>

          {/* Title (optional) */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-kumo-subtle uppercase tracking-wide">
              Agent Name <span className="text-kumo-subtle/60">(optional)</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="auth-refactor"
              className="px-3 py-2 bg-kumo-control border border-kumo-line rounded-md text-sm text-kumo-default outline-none focus:border-kumo-ring placeholder:text-kumo-subtle"
            />
          </div>

          {/* Prompt */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-kumo-subtle uppercase tracking-wide">
              Initial Prompt <span className="text-kumo-subtle/60">(optional — you can prompt from the session)</span>
            </label>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Leave empty to start an interactive session..."
              rows={3}
              className="px-3 py-2 bg-kumo-control border border-kumo-line rounded-md text-sm text-kumo-default outline-none focus:border-kumo-ring placeholder:text-kumo-subtle resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-kumo-line">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-kumo-subtle border border-kumo-line rounded-md hover:bg-kumo-fill transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleLaunch}
            disabled={!directory.trim() || launching || validating || !!dirError}
            className="px-4 py-2 text-xs font-medium text-white bg-kumo-brand rounded-md hover:bg-kumo-brand-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {launching ? 'Launching...' : 'Launch Agent'}
          </button>
        </div>
      </div>
    </div>
  )
}
