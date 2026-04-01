import { useState, useEffect, useMemo } from 'react'
import { X, FolderOpen, Clock, Warning } from '@phosphor-icons/react'
import { SelectField } from './SelectField'
import { useModelOptions } from '../hooks/useModelOptions'
import { loadSettings } from '../data/settings'

type WorktreeStrategy = 'new-worktree' | 'current-directory'

const RECENT_DIRS_KEY = 'oc-orchestrator:recent-directories'
const MAX_RECENT_DIRS = 5

function loadRecentDirs(): string[] {
  try {
    const stored = localStorage.getItem(RECENT_DIRS_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (Array.isArray(parsed)) return parsed.slice(0, MAX_RECENT_DIRS)
    }
  } catch {
    // ignore parse errors
  }
  return []
}

function saveRecentDir(dir: string): void {
  const recent = loadRecentDirs().filter((entry) => entry !== dir)
  recent.unshift(dir)
  localStorage.setItem(RECENT_DIRS_KEY, JSON.stringify(recent.slice(0, MAX_RECENT_DIRS)))
}

function sanitizePathSegment(value: string, fallback: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)

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

interface LaunchModalProps {
  onClose: () => void
  onLaunch: (directory: string, prompt?: string, title?: string, model?: string, worktreeStrategy?: string) => void
  onSelectDirectory: () => Promise<string | null>
  onValidateDirectory?: (dir: string) => Promise<boolean>
}

export function LaunchModal({ onClose, onLaunch, onSelectDirectory, onValidateDirectory }: LaunchModalProps) {
  const [directory, setDirectory] = useState('')
  const [prompt, setPrompt] = useState('')
  const [title, setTitle] = useState('')
  const [model, setModel] = useState(() => loadSettings().model)
  const { options: modelOptions } = useModelOptions()
  const [worktreeStrategy, setWorktreeStrategy] = useState<WorktreeStrategy>('new-worktree')
  const [launching, setLaunching] = useState(false)
  const [recentDirs] = useState<string[]>(loadRecentDirs)
  const [showRecentDirs, setShowRecentDirs] = useState(false)
  const [dirError, setDirError] = useState<string | null>(null)
  const [validating, setValidating] = useState(false)
  const [worktreeRoot, setWorktreeRoot] = useState('')

  const estimatedWorktreePath = useMemo(() => {
    if (worktreeStrategy !== 'new-worktree') return ''
    return computeWorktreePath(worktreeRoot, directory, title)
  }, [directory, title, worktreeRoot, worktreeStrategy])

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
      return
    }

    const timer = setTimeout(async () => {
      if (onValidateDirectory) {
        setValidating(true)
        try {
          const isValid = await onValidateDirectory(directory.trim())
          if (!isValid) {
            setDirError('This directory is not a valid git repository.')
          } else {
            setDirError(null)
          }
        } catch {
          setDirError('Could not validate directory.')
        } finally {
          setValidating(false)
        }
      }
    }, 500)

    return () => clearTimeout(timer)
  }, [directory, onValidateDirectory])

  const handleLaunch = async () => {
    if (!directory.trim() || dirError) return
    setLaunching(true)
    saveRecentDir(directory.trim())
    try {
      await onLaunch(directory, prompt || undefined, title || undefined, model, worktreeStrategy)
      onClose()
    } catch (error) {
      console.error('Launch failed:', error)
      setLaunching(false)
    }
  }

  const handleBrowse = async () => {
    const selected = await onSelectDirectory()
    if (selected) setDirectory(selected)
  }

  const handleSelectRecentDir = (dir: string) => {
    setDirectory(dir)
    setShowRecentDirs(false)
  }

  const selectButtonClasses =
    'flex w-full items-center justify-between gap-3 rounded-md border border-kumo-line bg-kumo-control px-3 py-2 text-sm text-kumo-default outline-none transition-colors hover:bg-kumo-fill focus:border-kumo-ring'

  const selectMenuClasses =
    'absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-kumo-line bg-kumo-overlay shadow-xl'

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
        <div className="px-5 py-4 flex flex-col gap-4 overflow-y-auto">
          {/* Directory */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-kumo-subtle uppercase tracking-wide">
              Project Directory
            </label>
            <div className="relative flex gap-2">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={directory}
                  onChange={(event) => setDirectory(event.target.value)}
                  onFocus={() => recentDirs.length > 0 && setShowRecentDirs(true)}
                  onBlur={() => setTimeout(() => setShowRecentDirs(false), 200)}
                  placeholder="/path/to/project"
                  className={`w-full px-3 py-2 bg-kumo-control border rounded-md text-sm text-kumo-default font-mono outline-none focus:border-kumo-ring placeholder:text-kumo-subtle ${
                    dirError ? 'border-kumo-danger' : 'border-kumo-line'
                  }`}
                />
                {/* Recent directories dropdown */}
                {showRecentDirs && recentDirs.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-kumo-overlay border border-kumo-line rounded-md shadow-xl z-10 overflow-hidden">
                    <div className="px-3 py-1.5 text-[10px] font-medium text-kumo-subtle uppercase tracking-wider flex items-center gap-1.5">
                      <Clock size={10} />
                      Recent
                    </div>
                    {recentDirs.map((recentDir) => (
                      <button
                        key={recentDir}
                        onMouseDown={() => handleSelectRecentDir(recentDir)}
                        className="w-full px-3 py-1.5 text-left text-xs font-mono text-kumo-default hover:bg-kumo-fill transition-colors truncate"
                      >
                        {recentDir}
                      </button>
                    ))}
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
            disabled={!directory.trim() || launching || !!dirError}
            className="px-4 py-2 text-xs font-medium text-white bg-kumo-brand rounded-md hover:bg-kumo-brand-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {launching ? 'Launching...' : 'Launch Agent'}
          </button>
        </div>
      </div>
    </div>
  )
}
