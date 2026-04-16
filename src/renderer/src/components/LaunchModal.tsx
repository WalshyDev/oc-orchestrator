import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { X, FolderOpen, CaretDown, Warning, Trash, Paperclip, ClockCounterClockwise, CircleNotch, ChatCircleDots, Play } from '@phosphor-icons/react'
import { SelectField } from './SelectField'
import { LabelDropdown } from './LabelDropdown'
import { useModelOptions } from '../hooks/useModelOptions'
import { useImageAttachments } from '../hooks/useImageAttachments'
import { loadSettings } from '../data/settings'
import type { LabelDefinition, LabelColorKey } from '../types'
import type { Project, MessageAttachment, ProjectSessionEntry } from '../types/api'
import type { ChatCommand, AgentConfigItem } from './DetailDrawer'

type WorktreeStrategy = 'new-worktree' | 'current-directory'
type ModalTab = 'new' | 'import'

export interface FreshWorktreeConfig {
  enabled: boolean
  baseBranch: string
}

export interface ImportSessionConfig {
  sessionId: string
  sessionTitle: string
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

function worktreeLabel(sessionDir: string, projectDir: string): string | null {
  if (!sessionDir || sessionDir === projectDir) return null
  const parts = sessionDir.replace(/\/$/, '').split('/')
  return parts[parts.length - 1] ?? null
}

function deriveForkedName(title: string): string {
  const match = title.match(/^(.*?)\s*\(fork(?:\s*#(\d+))?\)\s*$/)
  if (match) {
    const base = match[1]
    const num = match[2] ? parseInt(match[2], 10) + 1 : 2
    return `${base} (fork #${num})`
  }
  return `${title} (fork)`
}

interface KnownDirectory {
  name: string
  directory: string
  isWorktree?: boolean
}

interface LaunchModalProps {
  onClose: () => void
  onLaunch: (directory: string, prompt?: string, title?: string, model?: string, worktreeStrategy?: string, attachments?: MessageAttachment[], freshWorktreeConfig?: FreshWorktreeConfig, importSession?: ImportSessionConfig, labelIds?: string[]) => void
  onSelectDirectory: () => Promise<string | null>
  onValidateDirectory?: (dir: string) => Promise<boolean>
  knownDirectories?: KnownDirectory[]
  commands?: ChatCommand[]
  agentConfigs?: AgentConfigItem[]
  allLabels?: LabelDefinition[]
  onCreateLabel?: (name: string, colorKey: LabelColorKey) => Promise<LabelDefinition | null>
}

export function LaunchModal({ onClose, onLaunch, onSelectDirectory, onValidateDirectory, knownDirectories, commands = [], agentConfigs = [], allLabels = [], onCreateLabel }: LaunchModalProps) {
  const [activeTab, setActiveTab] = useState<ModalTab>('new')
  const [directory, setDirectory] = useState('')
  const [prompt, setPrompt] = useState('')
  const [title, setTitle] = useState('')
  const [model, setModel] = useState(() => loadSettings().model)
  const { options: modelOptions } = useModelOptions()
  const [worktreeStrategy, setWorktreeStrategy] = useState<WorktreeStrategy>('new-worktree')
  const [freshWorktree, setFreshWorktree] = useState(false)
  const [baseBranch, setBaseBranch] = useState('')
  const [labelIds, setLabelIds] = useState<string[]>([])
  const toggleLabelId = useCallback((id: string) => {
    setLabelIds((prev) => prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id])
  }, [])
  const [detectingBranch, setDetectingBranch] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [dirError, setDirError] = useState<string | null>(null)
  const [validating, setValidating] = useState(false)
  const [worktreeRoot, setWorktreeRoot] = useState('')
  const [savedProjects, setSavedProjects] = useState<Project[]>([])
  const [projectsReady, setProjectsReady] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [projectSearch, setProjectSearch] = useState('')
  const {
    attachments, isDragOver, fileInputRef,
    removeAttachment, clearAttachments,
    handlePaste, handleDragOver, handleDragEnter, handleDragLeave, handleDrop, handleFileInputChange
  } = useImageAttachments()
  const dropdownRef = useRef<HTMLDivElement>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const [cursorPos, setCursorPos] = useState(0)
  const [agentPickerDismissed, setAgentPickerDismissed] = useState(false)
  const [agentPickerIndex, setAgentPickerIndex] = useState(0)
  const [commandPickerIndex, setCommandPickerIndex] = useState(0)

  // Import tab state
  const [importSessions, setImportSessions] = useState<ProjectSessionEntry[]>([])
  const [importLoading, setImportLoading] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [selectedSession, setSelectedSession] = useState<ProjectSessionEntry | null>(null)
  const [importSearch, setImportSearch] = useState('')
  const [importName, setImportName] = useState('')
  const [importPrompt, setImportPrompt] = useState('')
  const [showSessionDropdown, setShowSessionDropdown] = useState(false)
  const sessionDropdownRef = useRef<HTMLDivElement>(null)

  const trimmedPrompt = prompt.trim().toLowerCase()

  const matchingCommands = useMemo(
    () => prompt.startsWith('/')
      ? commands.filter(({ command }) => command.startsWith(trimmedPrompt))
      : [],
    [prompt, trimmedPrompt, commands]
  )

  const showCommandAutocomplete = useMemo(() => {
    if (matchingCommands.length === 0 || trimmedPrompt.length === 0) return false
    return !commands.some(({ command }) => command === trimmedPrompt)
  }, [matchingCommands, trimmedPrompt, commands])

  const agentMentionResult = useMemo(() => {
    if (agentConfigs.length === 0) return null
    const textBeforeCursor = prompt.slice(0, cursorPos)
    const match = textBeforeCursor.match(/@(\w*)$/)
    if (!match) return null
    const start = textBeforeCursor.length - match[0].length
    return { query: match[1].toLowerCase(), start, end: cursorPos }
  }, [agentConfigs.length, prompt, cursorPos])

  const agentMention = !agentPickerDismissed ? agentMentionResult : null
  const matchingAgents = useMemo(
    () => agentMention
      ? agentConfigs.filter((cfg) => cfg.name.toLowerCase().startsWith(agentMention.query))
      : [],
    [agentMention, agentConfigs]
  )
  const showAgentPicker = matchingAgents.length > 0 && !showCommandAutocomplete

  const handlePromptChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setPrompt(event.target.value)
    setCursorPos(event.target.selectionStart)
    setAgentPickerDismissed(false)
    setAgentPickerIndex(0)
    setCommandPickerIndex(0)
  }

  const insertAgentMention = (agentName: string) => {
    if (!agentMention) return
    const before = prompt.slice(0, agentMention.start)
    const after = prompt.slice(agentMention.end)
    const newText = `${before}@${agentName} ${after}`
    const newCursorPos = agentMention.start + agentName.length + 2
    setPrompt(newText)
    setCursorPos(newCursorPos)
    setAgentPickerDismissed(false)
    setAgentPickerIndex(0)
    requestAnimationFrame(() => {
      const textarea = promptRef.current
      if (textarea) {
        textarea.selectionStart = newCursorPos
        textarea.selectionEnd = newCursorPos
        textarea.focus()
      }
    })
  }

  const handlePromptKeyDown = (event: React.KeyboardEvent) => {
    if (showAgentPicker) {
      if (event.key === 'Escape') { event.preventDefault(); setAgentPickerDismissed(true); return }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault()
        const selected = matchingAgents[agentPickerIndex]
        if (selected) insertAgentMention(selected.name)
        return
      }
      if (event.key === 'ArrowDown') { event.preventDefault(); setAgentPickerIndex((prev) => (prev + 1) % matchingAgents.length); return }
      if (event.key === 'ArrowUp') { event.preventDefault(); setAgentPickerIndex((prev) => (prev - 1 + matchingAgents.length) % matchingAgents.length); return }
    }

    if (showCommandAutocomplete) {
      if (event.key === 'Escape') { event.preventDefault(); setPrompt(''); return }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault()
        const selected = matchingCommands[commandPickerIndex]
        if (selected) setPrompt(`${selected.command} `)
        return
      }
      if (event.key === 'ArrowDown') { event.preventDefault(); setCommandPickerIndex((prev) => (prev + 1) % matchingCommands.length); return }
      if (event.key === 'ArrowUp') { event.preventDefault(); setCommandPickerIndex((prev) => (prev - 1 + matchingCommands.length) % matchingCommands.length); return }
    }
  }

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
    } catch { /* ignore */ }
  }, [])

  // Seed projects from running agents, load the full list, then restore
  // the last-used directory.
  useEffect(() => {
    let cancelled = false

    const seedKnownDirectories = async () => {
      if (!knownDirectories?.length) return
      const seen = new Set<string>()
      for (const known of knownDirectories) {
        try {
          let dir = known.directory
          if (known.isWorktree) {
            const result = await window.api.getCommonRepoRoot(known.directory)
            if (result.ok && result.data) dir = result.data
            else continue
          }
          if (seen.has(dir)) continue
          seen.add(dir)
          await window.api.ensureProject({ name: known.name, repoRoot: dir })
        } catch { /* ignore */ }
      }
    }

    const init = async () => {
      await seedKnownDirectories()
      if (cancelled) return

      let projects: Project[] = []
      try {
        const result = await window.api.listProjects()
        if (result.ok && result.data) {
          projects = result.data
          setSavedProjects(projects)
        }
      } catch { /* ignore */ }
      if (cancelled) return

      try {
        const result = await window.api.getPreference('launch:last-directory')
        if (result.ok && result.data && projects.some((p) => p.repo_root === result.data)) {
          setDirectory(result.data!)
        }
      } catch { /* ignore */ }

      if (!cancelled) setProjectsReady(true)
    }

    void init()
    return () => { cancelled = true }
  }, [])

  const removeProject = useCallback(async (projectId: string, event: React.MouseEvent) => {
    event.stopPropagation()
    event.preventDefault()
    try {
      await window.api.deleteProject(projectId)
      setSavedProjects((prev) => prev.filter((p) => p.id !== projectId))
      const removed = savedProjects.find((p) => p.id === projectId)
      if (removed && removed.repo_root === directory) setDirectory('')
    } catch { /* ignore */ }
  }, [directory, savedProjects])

  useEffect(() => {
    let isMounted = true
    const loadWorktreeRoot = async () => {
      try {
        const result = await window.api.getWorktreeRoot()
        if (isMounted && result.ok && result.data) setWorktreeRoot(result.data)
      } catch { /* ignore */ }
    }
    void loadWorktreeRoot()
    return () => { isMounted = false }
  }, [])

  useEffect(() => {
    if (!directory.trim()) { setDirError(null); setValidating(false); return }
    const currentDir = directory.trim()
    setValidating(true)
    const timer = setTimeout(async () => {
      if (onValidateDirectory) {
        try {
          const isValid = await onValidateDirectory(currentDir)
          setDirectory((latest) => {
            if (latest.trim() === currentDir) { setDirError(isValid ? null : 'This directory is not a valid git repository.'); setValidating(false) }
            return latest
          })
        } catch {
          setDirectory((latest) => {
            if (latest.trim() === currentDir) { setDirError('Could not validate directory.'); setValidating(false) }
            return latest
          })
        }
      } else {
        setValidating(false)
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [directory, onValidateDirectory])

  // Load per-project settings when directory changes
  useEffect(() => {
    const dir = directory.trim()
    if (!dir || !projectsReady) return
    let cancelled = false
    setDetectingBranch(true)
    const loadProjectSettings = async () => {
      try {
        const repoRootResult = await window.api.getRepoRoot(dir)
        if (cancelled) return
        const repoRoot = repoRootResult.ok && repoRootResult.data ? repoRootResult.data : dir
        const matchedProject = savedProjects.find((p) => p.repo_root === repoRoot)
        setFreshWorktree(!!matchedProject?.fresh_worktree)
        if (matchedProject?.default_branch) { setBaseBranch(matchedProject.default_branch); return }
        const branchResult = await window.api.getDefaultBranch(repoRoot)
        if (cancelled) return
        setBaseBranch(branchResult.ok && branchResult.data ? branchResult.data : 'origin/main')
      } catch {
        if (!cancelled) { setFreshWorktree(false); setBaseBranch('origin/main') }
      } finally {
        if (!cancelled) setDetectingBranch(false)
      }
    }
    void loadProjectSettings()
    return () => { cancelled = true }
  }, [directory, savedProjects, projectsReady])

  // Fetch sessions when import tab is active and directory is valid
  useEffect(() => {
    if (activeTab !== 'import' || !directory.trim() || dirError || validating) {
      setImportSessions([]); setImportError(null); setSelectedSession(null)
      return
    }
    let cancelled = false
    const fetchSessions = async () => {
      setImportLoading(true); setImportError(null); setImportSessions([]); setSelectedSession(null)
      try {
        const result = await window.api.listSessionsByProject(directory.trim())
        if (cancelled) return
        if (result.ok && result.data) {
          const sorted = [...result.data].sort((a, b) => b.updatedAt - a.updatedAt)
          setImportSessions(sorted)
          if (sorted.length === 0) setImportError('No sessions found for this project.')
        } else {
          setImportError(result.error ?? 'Failed to list sessions.')
        }
      } catch (err) {
        if (!cancelled) setImportError(String(err))
      } finally {
        if (!cancelled) setImportLoading(false)
      }
    }
    void fetchSessions()
    return () => { cancelled = true }
  }, [activeTab, directory, dirError, validating])

  // Reset import state when switching tabs
  useEffect(() => {
    if (activeTab !== 'import') { setSelectedSession(null); setImportSearch(''); setImportName(''); setImportPrompt('') }
  }, [activeTab])

  // Close session dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (sessionDropdownRef.current && !sessionDropdownRef.current.contains(event.target as Node)) {
        setShowSessionDropdown(false)
        setImportSearch('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const filteredImportSessions = useMemo(() => {
    if (!importSearch.trim()) return importSessions
    const q = importSearch.toLowerCase()
    return importSessions.filter((s) =>
      s.title.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)
    )
  }, [importSessions, importSearch])

  const filteredProjects = useMemo(() => {
    if (!projectSearch.trim()) return savedProjects
    const q = projectSearch.toLowerCase()
    return savedProjects.filter((p) =>
      p.name.toLowerCase().includes(q) || p.repo_root.toLowerCase().includes(q)
    )
  }, [savedProjects, projectSearch])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false)
        setProjectSearch('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const persistProjectSettings = async (dir: string) => {
    try {
      const repoRootResult = await window.api.getRepoRoot(dir)
      const canonicalRoot = repoRootResult.ok && repoRootResult.data ? repoRootResult.data : dir
      const name = dirDisplayName(canonicalRoot)
      const ensureResult = await window.api.ensureProject({ name, repoRoot: canonicalRoot })
      if (!ensureResult.ok) console.warn('Failed to ensure project:', ensureResult.error)
      const settingsResult = await window.api.updateProjectSettings({
        repoRoot: canonicalRoot,
        settings: { fresh_worktree: freshWorktree, default_branch: baseBranch || null }
      })
      if (!settingsResult.ok) console.warn('Failed to persist worktree settings:', settingsResult.error)
      await window.api.setPreference('launch:last-directory', canonicalRoot)
      await loadProjects()
    } catch (err) {
      console.warn('Failed to persist project settings:', err)
    }
  }

  const handleLaunch = async () => {
    if (!directory.trim() || dirError || validating) return
    if (activeTab === 'import' && !selectedSession) return
    setLaunching(true)
    try {
      const effectiveStrategy = activeTab === 'import' ? 'new-worktree' : worktreeStrategy

      const freshConfig: FreshWorktreeConfig | undefined =
        effectiveStrategy === 'new-worktree' && freshWorktree
          ? { enabled: true, baseBranch }
          : undefined

      const importConfig: ImportSessionConfig | undefined =
        activeTab === 'import' && selectedSession
          ? { sessionId: selectedSession.id, sessionTitle: selectedSession.title }
          : undefined

      const effectiveTitle = activeTab === 'import'
        ? (importName.trim() || selectedSession?.title || undefined)
        : (title || undefined)

      const effectivePrompt = activeTab === 'import'
        ? (importPrompt.trim() || undefined)
        : (prompt || undefined)

      const effectiveAttachments = activeTab === 'new' && attachments.length > 0
        ? attachments
        : undefined

      const effectiveLabels = labelIds.length > 0 ? labelIds : undefined

      await persistProjectSettings(directory.trim())
      await onLaunch(directory, effectivePrompt, effectiveTitle, model, effectiveStrategy, effectiveAttachments, freshConfig, importConfig, effectiveLabels)

      clearAttachments()
      onClose()
    } catch (error) {
      console.error('Launch failed:', error)
      setLaunching(false)
    }
  }

  const handleBrowse = async () => {
    const selected = await onSelectDirectory()
    if (selected) { setDirectory(selected); setShowDropdown(false); setProjectSearch('') }
  }

  const handleSelectProject = (repoRoot: string) => {
    setDirectory(repoRoot)
    setShowDropdown(false)
    setProjectSearch('')
  }

  const selectButtonClasses =
    'flex w-full items-center justify-between gap-3 rounded-md border border-kumo-line bg-kumo-control px-3 py-2 text-sm text-kumo-default outline-none transition-colors hover:bg-kumo-fill focus:border-kumo-ring'

  const selectMenuClasses =
    'absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-kumo-line bg-kumo-overlay shadow-xl'

  const selectedProject = savedProjects.find((p) => p.repo_root === directory)
  const hasDirectory = directory.trim().length > 0

  const isLaunchDisabled = activeTab === 'new'
    ? !directory.trim() || launching || validating || !!dirError
    : !directory.trim() || launching || validating || !!dirError || !selectedSession

  const launchButtonLabel = launching
    ? 'Launching...'
    : activeTab === 'import' && selectedSession
      ? 'Fork & Launch'
      : 'Launch Agent'

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[560px] max-h-[85vh] bg-kumo-elevated border border-kumo-line rounded-xl shadow-2xl flex flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header with tabs */}
        <div className="flex flex-col border-b border-kumo-line">
          <div className="flex items-center justify-between px-5 pt-4 pb-0">
            <h2 className="text-base font-semibold text-kumo-strong">Launch Agent</h2>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-md border border-kumo-line text-kumo-subtle hover:text-kumo-default hover:bg-kumo-fill transition-colors"
            >
              <X size={14} />
            </button>
          </div>
          <div className="flex gap-0 px-5 mt-3">
            <button
              type="button"
              onClick={() => setActiveTab('new')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 transition-colors -mb-px ${
                activeTab === 'new'
                  ? 'text-kumo-default border-kumo-brand'
                  : 'text-kumo-subtle border-transparent hover:text-kumo-default'
              }`}
            >
              <Play size={12} weight="bold" />
              New Agent
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('import')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 transition-colors -mb-px ${
                activeTab === 'import'
                  ? 'text-kumo-default border-kumo-brand'
                  : 'text-kumo-subtle border-transparent hover:text-kumo-default'
              }`}
            >
              <ClockCounterClockwise size={12} weight="bold" />
              Import Session
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 flex flex-col gap-4 overflow-y-auto overflow-x-hidden min-h-0 flex-1">
          {/* Directory Selector — shared between tabs */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-kumo-subtle uppercase tracking-wide">
              Project Directory
            </label>
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
                  <div className="fixed mt-1 bg-kumo-control border border-kumo-fill-hover rounded-md shadow-2xl z-[210] max-h-[320px] flex flex-col overflow-hidden" style={{
                    width: dropdownRef.current?.querySelector('button')?.getBoundingClientRect().width,
                    left: dropdownRef.current?.querySelector('button')?.getBoundingClientRect().left,
                    top: (dropdownRef.current?.querySelector('button')?.getBoundingClientRect().bottom ?? 0) + 4
                  }}>
                    {savedProjects.length > 0 && (
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
                      {filteredProjects.length > 0 && (
                        <>
                          <div className="px-3 py-1.5 text-[10px] font-medium text-kumo-subtle uppercase tracking-wider">
                            Saved Projects
                          </div>
                          {filteredProjects.map((project) => (
                            <div
                              key={project.id}
                              className="group flex items-center px-3 py-1.5 hover:bg-kumo-fill-hover transition-colors cursor-pointer"
                              onMouseDown={() => handleSelectProject(project.repo_root)}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="text-xs text-kumo-default font-medium truncate">{project.name}</div>
                                <div className="text-[11px] text-kumo-subtle font-mono truncate">{project.repo_root}</div>
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
                      {filteredProjects.length === 0 && savedProjects.length > 0 && (
                        <div className="px-3 py-4 text-xs text-kumo-subtle text-center">No matching projects</div>
                      )}
                      <button
                        onMouseDown={() => void handleBrowse()}
                        className="w-full px-3 py-2 text-left text-xs text-kumo-default hover:bg-kumo-fill-hover transition-colors flex items-center gap-2"
                      >
                        <FolderOpen size={14} className="text-kumo-subtle" />
                        Browse for directory...
                      </button>
                    </div>
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
            {validating && <p className="text-[11px] text-kumo-subtle">Validating directory...</p>}
            {dirError && (
              <p className="text-[11px] text-kumo-danger flex items-center gap-1">
                <Warning size={12} />
                {dirError}
              </p>
            )}
          </div>

          {/* ── New Agent Tab ── */}
          {activeTab === 'new' && (
            <>
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
                {worktreeStrategy === 'new-worktree' && (
                  <div className="flex flex-col gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => setFreshWorktree(!freshWorktree)}
                      className="flex items-center gap-2 text-xs text-kumo-default cursor-pointer select-none group"
                    >
                      <span className={`flex items-center justify-center w-3.5 h-3.5 rounded border transition-colors ${
                        freshWorktree
                          ? 'bg-kumo-brand border-kumo-brand text-white'
                          : 'border-kumo-line bg-kumo-control group-hover:border-kumo-subtle'
                      }`}>
                        {freshWorktree && <span className="text-[9px] font-bold leading-none">&#10003;</span>}
                      </span>
                      Fetch latest from base branch
                    </button>
                    {freshWorktree && (
                      <input
                        type="text"
                        value={baseBranch}
                        onChange={(e) => setBaseBranch(e.target.value)}
                        placeholder={detectingBranch ? 'Detecting...' : 'origin/main'}
                        disabled={detectingBranch}
                        className="w-full rounded-md border border-kumo-line bg-kumo-control px-2.5 py-1.5 text-xs text-kumo-default font-mono placeholder:text-kumo-subtle outline-none transition-colors focus:border-kumo-ring disabled:opacity-50"
                      />
                    )}
                  </div>
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

              {/* Labels */}
              {allLabels.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-kumo-subtle uppercase tracking-wide">
                    Labels <span className="text-kumo-subtle/60">(optional)</span>
                  </label>
                  <LabelDropdown
                    current={labelIds}
                    onToggle={toggleLabelId}
                    onClear={() => setLabelIds([])}
                    allLabels={allLabels}
                    onCreateLabel={onCreateLabel}
                    variant="action"
                  />
                </div>
              )}

              {/* Prompt */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-kumo-subtle uppercase tracking-wide">
                  Initial Prompt <span className="text-kumo-subtle/60">(optional — you can prompt from the session)</span>
                </label>
                <div
                  className={`relative flex flex-col gap-0 rounded-md border transition-colors ${
                    isDragOver ? 'border-kumo-brand bg-kumo-brand/[0.04]' : 'border-kumo-line focus-within:border-kumo-ring'
                  }`}
                  onDragOver={handleDragOver}
                  onDragEnter={handleDragEnter}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  {attachments.length > 0 && (
                    <div className="flex gap-2 px-3 py-2 overflow-x-auto">
                      {attachments.map((att) => (
                        <div key={att.id} className="relative group shrink-0">
                          <img
                            src={att.dataUrl}
                            alt={att.filename ?? 'attachment'}
                            className="h-16 w-16 rounded-md border border-kumo-line object-cover"
                          />
                          <button
                            type="button"
                            onClick={() => removeAttachment(att.id!)}
                            className="absolute -top-1.5 -right-1.5 w-4 h-4 flex items-center justify-center rounded-full bg-kumo-danger text-white text-[9px] font-bold opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X size={8} weight="bold" />
                          </button>
                          {att.filename && (
                            <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[8px] px-1 py-0.5 rounded-b-md truncate">
                              {att.filename}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {showCommandAutocomplete && (
                    <div className="absolute bottom-full left-0 right-0 z-20 mb-2 rounded-lg border border-kumo-line bg-kumo-overlay p-1 shadow-xl">
                      {matchingCommands.map((item, index) => (
                        <button
                          key={item.command}
                          type="button"
                          onMouseDown={(event) => { event.preventDefault(); setPrompt(`${item.command} `) }}
                          className={`flex w-full items-start gap-3 rounded-md px-2.5 py-2 text-left transition-colors ${
                            index === commandPickerIndex ? 'bg-kumo-fill' : 'hover:bg-kumo-fill'
                          }`}
                        >
                          <span className="font-mono text-[11px] text-kumo-default">{item.command}</span>
                          <span className="text-[11px] text-kumo-subtle">{item.description}</span>
                        </button>
                      ))}
                      <div className="px-2.5 py-1 text-[10px] text-kumo-subtle border-t border-kumo-line mt-1 pt-1">
                        Tab/Enter to select · Arrow keys to navigate · Esc to dismiss
                      </div>
                    </div>
                  )}

                  {showAgentPicker && (
                    <div className="absolute bottom-full left-0 right-0 z-20 mb-2 rounded-lg border border-kumo-line bg-kumo-overlay p-1 shadow-xl">
                      <div className="px-2.5 py-1.5 text-[10px] font-medium text-kumo-subtle uppercase tracking-wide">Agents</div>
                      {matchingAgents.map((cfg, index) => (
                        <button
                          key={cfg.name}
                          type="button"
                          onMouseDown={(event) => { event.preventDefault(); insertAgentMention(cfg.name) }}
                          className={`flex w-full items-start gap-3 rounded-md px-2.5 py-2 text-left transition-colors ${
                            index === agentPickerIndex ? 'bg-kumo-fill' : 'hover:bg-kumo-fill'
                          }`}
                        >
                          <span className="font-mono text-[11px] text-kumo-brand">@{cfg.name}</span>
                          {cfg.description && <span className="text-[11px] text-kumo-subtle truncate">{cfg.description}</span>}
                        </button>
                      ))}
                      <div className="px-2.5 py-1 text-[10px] text-kumo-subtle border-t border-kumo-line mt-1 pt-1">
                        Tab/Enter to select · Arrow keys to navigate · Esc to dismiss
                      </div>
                    </div>
                  )}

                  <textarea
                    ref={promptRef}
                    value={prompt}
                    onChange={handlePromptChange}
                    onKeyDown={handlePromptKeyDown}
                    onKeyUp={(e) => setCursorPos(e.currentTarget.selectionStart)}
                    onClick={(e) => setCursorPos(e.currentTarget.selectionStart)}
                    onPaste={handlePaste}
                    placeholder={isDragOver ? 'Drop image here...' : 'Leave empty to start an interactive session... Type / for commands, @ for agents.'}
                    rows={3}
                    className="px-3 py-2 bg-kumo-control rounded-md text-sm text-kumo-default outline-none placeholder:text-kumo-subtle resize-none border-0 focus:ring-0"
                  />
                  <div className="flex items-center gap-2 px-3 py-1.5 border-t border-kumo-line">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-1 text-[10px] text-kumo-subtle hover:text-kumo-default transition-colors"
                      title="Attach image"
                    >
                      <Paperclip size={11} />
                      <span>Attach image</span>
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/gif,image/webp"
                      multiple
                      className="hidden"
                      onChange={handleFileInputChange}
                    />
                    <span className="text-[10px] text-kumo-subtle/60">Paste or drag images to attach.</span>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ── Import Session Tab ── */}
          {activeTab === 'import' && (
            <>
              {hasDirectory && !dirError && !validating && (
                <>
                  {/* Session dropdown */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-kumo-subtle uppercase tracking-wide">
                      Session
                    </label>
                    <div className="relative" ref={sessionDropdownRef}>
                      <button
                        type="button"
                        onClick={() => { if (!importLoading && !importError) setShowSessionDropdown(!showSessionDropdown) }}
                        disabled={importLoading}
                        className={`w-full flex items-center gap-2 px-3 py-2 bg-kumo-control border border-kumo-line rounded-md text-sm outline-none transition-colors ${
                          importLoading ? 'opacity-60 cursor-wait' : 'hover:bg-kumo-fill focus:border-kumo-ring'
                        }`}
                      >
                        <div className="min-w-0 flex-1 text-left truncate">
                          {importLoading ? (
                            <span className="flex items-center gap-2 text-kumo-subtle">
                              <CircleNotch size={13} className="animate-spin shrink-0" />
                              Loading sessions...
                            </span>
                          ) : importError ? (
                            <span className="text-kumo-subtle">{importError}</span>
                          ) : selectedSession ? (
                            <>
                              <span className="text-kumo-default font-medium">{selectedSession.title}</span>
                              <span className="text-kumo-subtle text-xs ml-2">{formatTimestamp(selectedSession.updatedAt)}</span>
                            </>
                          ) : (
                            <span className="text-kumo-subtle">
                              {importSessions.length === 0 ? 'No sessions found' : 'Select a session...'}
                            </span>
                          )}
                        </div>
                        {!importLoading && <CaretDown size={14} className="text-kumo-subtle shrink-0" />}
                      </button>

                      {showSessionDropdown && !importLoading && importSessions.length > 0 && (
                        <div className="fixed mt-1 bg-kumo-control border border-kumo-fill-hover rounded-md shadow-2xl z-[210] max-h-[320px] flex flex-col overflow-hidden" style={{
                          width: sessionDropdownRef.current?.getBoundingClientRect().width,
                          left: sessionDropdownRef.current?.getBoundingClientRect().left,
                          top: (sessionDropdownRef.current?.getBoundingClientRect().bottom ?? 0) + 4
                        }}>
                          <div className="px-2 pt-2 pb-1 shrink-0">
                            <input
                              type="text"
                              value={importSearch}
                              onChange={(e) => setImportSearch(e.target.value)}
                              placeholder="Search sessions..."
                              className="w-full rounded border border-kumo-line bg-kumo-elevated px-2 py-1 text-xs text-kumo-default placeholder:text-kumo-subtle outline-none focus:border-kumo-ring"
                              autoFocus
                            />
                          </div>
                          <div className="overflow-y-auto flex-1">
                            {filteredImportSessions.map((session) => {
                              const isSelected = selectedSession?.id === session.id
                              const wtLabel = worktreeLabel(session.directory, directory.trim())
                              return (
                                <div
                                  key={session.id}
                                  onMouseDown={() => {
                                    setSelectedSession(session)
                                    setImportName(deriveForkedName(session.title))
                                    setShowSessionDropdown(false)
                                    setImportSearch('')
                                  }}
                                  className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors ${
                                    isSelected ? 'bg-kumo-brand/10' : 'hover:bg-kumo-fill-hover'
                                  }`}
                                >
                                  <div className="flex-1 min-w-0">
                                    <div className="text-xs text-kumo-default font-medium truncate">{session.title}</div>
                                    <div className="flex items-center gap-1.5 text-[10px] text-kumo-subtle mt-0.5">
                                      <span>{formatTimestamp(session.updatedAt)}</span>
                                      {wtLabel && (
                                        <>
                                          <span className="text-kumo-line">|</span>
                                          <span className="font-mono truncate">{wtLabel}</span>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                  {isSelected && (
                                    <span className="shrink-0 text-[10px] font-medium text-kumo-brand">&#10003;</span>
                                  )}
                                </div>
                              )
                            })}
                            {filteredImportSessions.length === 0 && (
                              <div className="px-3 py-4 text-xs text-kumo-subtle text-center">No matching sessions</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    <p className="text-[11px] text-kumo-subtle -mt-0.5">
                      Creates a new worktree and copies the session history into it.
                    </p>
                  </div>

                  {/* Name + Model — shown after session selected */}
                  {selectedSession && (
                    <>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-kumo-subtle uppercase tracking-wide">
                          Agent Name
                        </label>
                        <input
                          type="text"
                          value={importName}
                          onChange={(e) => setImportName(e.target.value)}
                          placeholder={selectedSession.title}
                          className="px-3 py-2 bg-kumo-control border border-kumo-line rounded-md text-sm text-kumo-default outline-none focus:border-kumo-ring placeholder:text-kumo-subtle"
                        />
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-kumo-subtle uppercase tracking-wide">
                          Model
                        </label>
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

                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-kumo-subtle uppercase tracking-wide">
                          Initial Prompt <span className="text-kumo-subtle/60">(optional)</span>
                        </label>
                        <textarea
                          value={importPrompt}
                          onChange={(e) => setImportPrompt(e.target.value)}
                          placeholder="Continue where you left off, or give new instructions..."
                          rows={2}
                          className="px-3 py-2 bg-kumo-control border border-kumo-line rounded-md text-sm text-kumo-default outline-none placeholder:text-kumo-subtle resize-none focus:border-kumo-ring"
                        />
                      </div>
                    </>
                  )}
                </>
              )}

              {!hasDirectory && !validating && (
                <div className="flex items-center justify-center py-8 text-xs text-kumo-subtle">
                  Select a project directory to browse sessions.
                </div>
              )}
            </>
          )}
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
            disabled={isLaunchDisabled}
            className="px-4 py-2 text-xs font-medium text-white bg-kumo-brand rounded-md hover:bg-kumo-brand-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {launchButtonLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
