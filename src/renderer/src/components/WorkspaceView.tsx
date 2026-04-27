import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { editor } from 'monaco-editor'
import { DiffEditor, loader } from '@monaco-editor/react'
import * as monacoNs from 'monaco-editor'
import {
  ArrowLeft,
  ArrowsClockwise,
  CaretDown,
  CaretUp,
  CheckCircle,
  CircleNotch,
  FileText,
  FloppyDisk,
  FolderSimple,
  Warning
} from '@phosphor-icons/react'
import { HighlightAskPopover, type HighlightSelection } from './HighlightAskPopover'
import { languageForPath } from '../lib/language'

// Wire the Monaco loader to the bundled copy so it doesn't try to fetch from a
// CDN at runtime — we can't hit the network reliably in a packaged Electron
// app, and the CDN fetch would be a privacy leak anyway.
loader.config({ monaco: monacoNs })

interface WorkspaceViewProps {
  agentId: string
  agentName: string
  projectName: string
  branchName: string
  /** Current agent status. Used to show a warning when editing would race with
   *  live agent writes in a later PR; for now purely informational. */
  agentStatus: string
  /** Pre-select a specific file on open (e.g. when the user clicked a file
   *  entry in the Files Changed tab). Falls back to the first file in the
   *  git-status result when null/undefined. */
  initialFilePath?: string | null
  /** Called when the user backs out of the workspace view, returning to the fleet. */
  onClose: () => void
  /** Hands a composed message (from the highlight-to-ask popover) back to the
   *  main send path, so it uses the same history/attachments/command pipeline
   *  as the chat input. */
  onSendMessage: (text: string) => void
}

interface GitStatusFile {
  path: string
  oldPath?: string
  status: string
  staged: boolean
  unstaged: boolean
}

interface DiffSides {
  before: string
  after: string
}

const STATUS_COLORS: Record<string, string> = {
  added: 'text-emerald-400',
  modified: 'text-sky-400',
  deleted: 'text-rose-400',
  renamed: 'text-amber-400',
  copied: 'text-amber-400',
  typechange: 'text-amber-400',
  unmerged: 'text-rose-400',
  untracked: 'text-neutral-400'
}

const STATUS_GLYPHS: Record<string, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  typechange: 'T',
  unmerged: 'U',
  untracked: '?'
}

/** Autosave debounce: 1s after the last keystroke. Long enough to batch a
 *  paste or rapid typing, short enough that you don't lose work if the app
 *  crashes. */
const AUTOSAVE_DEBOUNCE_MS = 1000

/** Stable subscription id for the file watcher — we reuse it on file switch
 *  so the main process just rebinds the single watch rather than accumulating
 *  handles. Scoped per WorkspaceView instance so multiple open views don't
 *  trample. */
function makeWatchSubscriptionId(): string {
  return `workspace-view-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Full-window review surface for an agent's uncommitted work. Shows a git-
 * status-backed file list on the left and a Monaco diff viewer on the right.
 *
 * The modified (right-hand) side is editable — light edits save on autosave
 * debounce (1s after last keystroke) plus Cmd+S. The original (HEAD) side
 * is always read-only; the concept of editing historical content doesn't
 * make sense for this workflow.
 *
 * Selecting text in either side surfaces a "Ask about this" popover that
 * composes a citation-quoted question and routes it through the normal
 * chat send path.
 *
 * Conflict handling: a narrow fs watcher observes the currently-open file.
 * When it fires:
 *   - If the editor buffer is clean (no unsaved edits), silently reload.
 *   - If the buffer is dirty, show a banner letting the user choose between
 *     discarding their edits and keeping them (which will overwrite on next
 *     save).
 * On save, if the on-disk mtime advanced since we last read, we surface a
 * conflict modal so the user isn't clobbered silently.
 */
export function WorkspaceView({
  agentId,
  agentName,
  projectName,
  branchName,
  agentStatus,
  initialFilePath,
  onClose,
  onSendMessage
}: WorkspaceViewProps) {
  const [files, setFiles] = useState<GitStatusFile[]>([])
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [statusError, setStatusError] = useState<string | null>(null)
  // Seed selection from the caller's initial path; falls back to first file
  // after the git-status fetch completes if the initial path isn't in the
  // status list (e.g. file was since staged/committed elsewhere).
  const [selectedPath, setSelectedPath] = useState<string | null>(initialFilePath ?? null)
  const [diffSides, setDiffSides] = useState<DiffSides | null>(null)
  const [loadingDiff, setLoadingDiff] = useState(false)
  const [diffError, setDiffError] = useState<string | null>(null)

  // ── Editing state ─────────────────────────────────────────────────────────
  // Whether the buffer has unsaved edits relative to what's on disk.
  const [isDirty, setIsDirty] = useState(false)
  // mtime observed when we last read the file; used for optimistic-concurrency
  // checks on save. Refs not state because it's pure IO metadata — no render
  // depends on it directly.
  const mtimeAtReadRef = useRef<number | null>(null)
  // The text we last successfully read or saved. Used to decide "is the
  // current editor value dirty?" on each change event.
  const lastSyncedContentRef = useRef<string>('')
  // External-change banner: populated when the file watcher fires while the
  // buffer is dirty. Clearing it (Keep mine / Reload) closes the banner.
  const [externalChange, setExternalChange] = useState<{ mtimeMs: number | null } | null>(null)
  // Transient save state for the header indicator.
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'conflict' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  // Conflict modal state: shown after a rejected save so the user can pick
  // Overwrite / Discard mine / Cancel without losing their edits.
  const [conflictModal, setConflictModal] = useState<{ currentMtimeMs: number | null } | null>(null)

  const [popover, setPopover] = useState<{ anchor: { x: number; y: number }; selection: HighlightSelection } | null>(null)

  const diffEditorRef = useRef<editor.IStandaloneDiffEditor | null>(null)
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // One stable watcher subscription id per view instance.
  const watchSubIdRef = useRef<string>(makeWatchSubscriptionId())

  // ── Fetch git status ─────────────────────────────────────────────────────
  const refreshStatus = useCallback(async () => {
    setLoadingStatus(true)
    setStatusError(null)
    try {
      const result = await window.api.getGitStatus(agentId)
      if (!result.ok || !result.data) {
        setStatusError(result.error ?? 'Failed to load git status')
        setFiles([])
      } else {
        const sorted = [...result.data].sort((a, b) => a.path.localeCompare(b.path))
        setFiles(sorted)
        // Auto-select the first file on initial load if nothing selected yet.
        setSelectedPath((current) => current ?? sorted[0]?.path ?? null)
      }
    } catch (error) {
      setStatusError(String(error))
      setFiles([])
    } finally {
      setLoadingStatus(false)
    }
  }, [agentId])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  // ── Fetch diff for selected file ─────────────────────────────────────────
  // Called on every file switch or reload-from-disk. Re-stamps mtime and
  // re-primes the lastSynced reference, invalidating any stale dirty flag.
  const loadDiff = useCallback(async (filePath: string) => {
    setLoadingDiff(true)
    setDiffError(null)
    try {
      const diffResult = await window.api.getGitDiff(agentId, filePath)
      if (!diffResult.ok || !diffResult.data) {
        setDiffError(diffResult.error ?? 'Failed to load diff')
        setDiffSides(null)
        mtimeAtReadRef.current = null
        return
      }
      setDiffSides(diffResult.data)

      // Pull the mtime via readFile so we have a concurrency stamp for
      // saves. This is a separate round-trip from the diff (which comes
      // from git-show), but it's cheap and it's the only way to get the
      // working-tree mtime. For deleted files readFile fails; that's
      // expected — no editing there, so we just fall back to the diff's
      // "after" side (which will be empty) for the synced content.
      const readResult = await window.api.readFile(agentId, filePath).catch(() => null)
      if (readResult?.ok && readResult.data) {
        mtimeAtReadRef.current = readResult.data.mtimeMs
        lastSyncedContentRef.current = readResult.data.content
      } else {
        mtimeAtReadRef.current = null
        lastSyncedContentRef.current = diffResult.data.after
      }

      setIsDirty(false)
      setExternalChange(null)
      setSaveState('idle')
      setSaveError(null)
    } catch (error) {
      setDiffError(String(error))
      setDiffSides(null)
      mtimeAtReadRef.current = null
    } finally {
      setLoadingDiff(false)
    }
  }, [agentId])

  useEffect(() => {
    if (!selectedPath) {
      setDiffSides(null)
      mtimeAtReadRef.current = null
      return
    }
    void loadDiff(selectedPath)
  }, [selectedPath, loadDiff])

  const selectedFile = useMemo(() => files.find((file) => file.path === selectedPath) ?? null, [files, selectedPath])

  // Deleted files can't be edited — we have nothing in the working tree to
  // save back. Also the diff is empty on the modified side so Monaco would
  // happily accept edits that go nowhere useful.
  const canEdit = !!selectedFile && selectedFile.status !== 'deleted'

  // ── Save ──────────────────────────────────────────────────────────────────
  /**
   * Write the current modified-side buffer to disk. `force` overrides the
   * mtime concurrency check (used by the "Overwrite" action in the conflict
   * modal). Returns a promise so callers (Cmd+S, autosave, conflict modal)
   * can await completion and coordinate state transitions.
   */
  const saveFile = useCallback(async (force: boolean = false): Promise<void> => {
    if (!selectedPath || !canEdit) return
    const editorInstance = diffEditorRef.current
    if (!editorInstance) return
    const model = editorInstance.getModifiedEditor().getModel()
    if (!model) return
    const content = model.getValue()

    // Nothing to do if buffer matches disk.
    if (content === lastSyncedContentRef.current && !force) {
      setIsDirty(false)
      return
    }

    setSaveState('saving')
    setSaveError(null)
    try {
      const expectedMtime = force ? null : mtimeAtReadRef.current
      const result = await window.api.writeFile(agentId, selectedPath, content, expectedMtime)
      if (!result.ok) {
        if (result.error === 'CONFLICT') {
          // Surface the conflict modal so the user picks. We leave isDirty
          // true so their edits aren't lost; they can discard, overwrite,
          // or cancel.
          setSaveState('conflict')
          setConflictModal({ currentMtimeMs: result.data?.currentMtimeMs ?? null })
          return
        }
        setSaveState('error')
        setSaveError(result.error ?? 'Save failed')
        return
      }
      if (!result.data) return
      mtimeAtReadRef.current = result.data.mtimeMs
      lastSyncedContentRef.current = content
      setIsDirty(false)
      setSaveState('saved')
      // Auto-clear the "saved" indicator after a moment so it doesn't linger.
      setTimeout(() => {
        setSaveState((prev) => (prev === 'saved' ? 'idle' : prev))
      }, 1200)
    } catch (error) {
      setSaveState('error')
      setSaveError(String(error))
    }
  }, [agentId, selectedPath, canEdit])

  // ── Autosave: 1s debounce after last edit ─────────────────────────────────
  // We keep a ref-based timer so re-renders don't clobber it. When the buffer
  // goes clean (dirty=false) we cancel any pending save — nothing to save.
  useEffect(() => {
    if (!isDirty) {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current)
        autosaveTimerRef.current = null
      }
      return
    }
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null
      void saveFile(false)
    }, AUTOSAVE_DEBOUNCE_MS)
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current)
        autosaveTimerRef.current = null
      }
    }
  }, [isDirty, saveFile])

  // Save any pending edits on file switch / unmount. Without this, switching
  // files during the 1s debounce window would drop the save (diff reload
  // clears dirty=false, cancelling the pending timer).
  //
  // We read isDirty and saveFile via refs so the effect only re-runs on
  // file switch — otherwise it would re-arm on every keystroke, flushing
  // mid-typing. The refs are updated by the effect below.
  const isDirtyRef = useRef(isDirty)
  const saveFileRef = useRef(saveFile)
  useEffect(() => {
    isDirtyRef.current = isDirty
    saveFileRef.current = saveFile
  })
  useEffect(() => {
    return () => {
      if (isDirtyRef.current) {
        void saveFileRef.current(false)
      }
    }
  }, [selectedPath])

  // Cmd+S shortcut — explicit save request, bypasses debounce.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault()
        if (canEdit) void saveFile(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [canEdit, saveFile])

  // ── File watcher: detect external changes to the open file ──────────────
  // One fs.watch per open file. On change we either silently reload (clean
  // buffer) or show a banner letting the user choose (dirty buffer). The
  // subscription id stays stable across file switches so the main process
  // rebinds the single watch rather than accumulating handles.
  useEffect(() => {
    if (!selectedPath) return
    const subId = watchSubIdRef.current
    let disposed = false

    const unsubscribe = window.api.onFileChanged((data) => {
      if (data.subscriptionId !== subId) return
      if (disposed) return
      if (data.event === 'error' || data.event === 'renamed') {
        // Bail — the watch is no longer valid. Next save will see the error.
        return
      }
      if (data.event === 'deleted') {
        // File vanished. Tell the user; their buffer is effectively orphaned.
        setExternalChange({ mtimeMs: null })
        return
      }

      // Ignore events where the mtime matches what we think it is — this
      // catches the echo of our own writes landing.
      if (data.mtimeMs && mtimeAtReadRef.current && data.mtimeMs === mtimeAtReadRef.current) {
        return
      }

      if (isDirty) {
        // User has unsaved edits. Show banner so they decide.
        setExternalChange({ mtimeMs: data.mtimeMs ?? null })
      } else {
        // Clean buffer — reload silently. The existing diff-fetch re-primes
        // the mtime ref, so subsequent saves won't false-alarm as conflicts.
        void loadDiff(selectedPath)
      }
    })

    void window.api.watchFile(agentId, subId, selectedPath)

    return () => {
      disposed = true
      unsubscribe()
      void window.api.unwatchFile(subId)
    }
  }, [agentId, selectedPath, isDirty, loadDiff])

  // ── Hunk navigation ──────────────────────────────────────────────────────
  const handleJumpHunk = useCallback((direction: 'next' | 'prev') => {
    const editorInstance = diffEditorRef.current
    if (!editorInstance) return

    const changes = editorInstance.getLineChanges()
    if (!changes || changes.length === 0) return

    const modifiedEditor = editorInstance.getModifiedEditor()
    const currentLine = modifiedEditor.getPosition()?.lineNumber ?? 1

    let target: typeof changes[number] | undefined
    if (direction === 'next') {
      target = changes.find((change) => change.modifiedStartLineNumber > currentLine) ?? changes[0]
    } else {
      const reversed = [...changes].reverse()
      target = reversed.find((change) => change.modifiedStartLineNumber < currentLine) ?? changes[changes.length - 1]
    }

    if (!target) return
    const line = target.modifiedStartLineNumber || 1
    modifiedEditor.revealLineInCenter(line)
    modifiedEditor.setPosition({ lineNumber: line, column: 1 })
  }, [])

  const handleJumpFile = useCallback((direction: 'next' | 'prev') => {
    if (files.length === 0) return
    const currentIndex = selectedPath ? files.findIndex((file) => file.path === selectedPath) : -1
    const nextIndex = direction === 'next'
      ? (currentIndex + 1) % files.length
      : (currentIndex - 1 + files.length) % files.length
    setSelectedPath(files[nextIndex].path)
  }, [files, selectedPath])

  // ── Highlight-to-ask wiring ──────────────────────────────────────────────
  const captureSelection = useCallback(() => {
    const editorInstance = diffEditorRef.current
    if (!editorInstance || !selectedPath) return

    // Prefer the modified (right-hand) editor, fall back to original if the
    // user is selecting from the HEAD side.
    const modified = editorInstance.getModifiedEditor()
    const original = editorInstance.getOriginalEditor()
    const activeEditor = modified.hasTextFocus() ? modified : original.hasTextFocus() ? original : null
    if (!activeEditor) return

    const selection = activeEditor.getSelection()
    if (!selection || selection.isEmpty()) return

    const model = activeEditor.getModel()
    if (!model) return

    const selectedText = model.getValueInRange(selection)
    if (!selectedText.trim()) return

    // Trim whitespace-only leading/trailing lines but keep inner indentation.
    const trimmed = selectedText.replace(/^\s*\n+/, '').replace(/\n+\s*$/, '')

    const startLine = selection.startLineNumber
    const endLine = selection.endLineNumber
    const lineRange = startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`

    // Anchor the popover just below the selection end, using Monaco's coords.
    const domNode = activeEditor.getDomNode()
    if (!domNode) return
    const rect = domNode.getBoundingClientRect()
    const lineTop = activeEditor.getTopForLineNumber(endLine) - activeEditor.getScrollTop()
    const x = rect.left + 80 // offset past line numbers so the popover isn't clipped
    const y = rect.top + lineTop + 24

    setPopover({
      anchor: { x, y },
      selection: {
        text: trimmed,
        source: `${selectedPath}:${lineRange}`,
        language: languageForPath(selectedPath)
      }
    })
  }, [selectedPath])

  const handleDiffMount = useCallback((editorInstance: editor.IStandaloneDiffEditor) => {
    diffEditorRef.current = editorInstance
    const modified = editorInstance.getModifiedEditor()
    const original = editorInstance.getOriginalEditor()

    // Only fire the popover once the selection is *settled*: mouseup ends a
    // drag, keyup catches shift+arrow selections. Listening to
    // onDidChangeCursorSelection would fire on every intermediate frame of a
    // drag, popping the dialog before the user is done highlighting.
    const onPointerUp = () => requestAnimationFrame(captureSelection)
    const onKeyUp = (event: KeyboardEvent) => {
      // Only interesting when the user was extending a selection — plain
      // arrow movement / typing shouldn't trigger the popover.
      if (event.shiftKey || event.key === 'Shift') {
        requestAnimationFrame(captureSelection)
      }
    }

    const modifiedDom = modified.getDomNode()
    const originalDom = original.getDomNode()
    modifiedDom?.addEventListener('mouseup', onPointerUp)
    modifiedDom?.addEventListener('keyup', onKeyUp)
    originalDom?.addEventListener('mouseup', onPointerUp)
    originalDom?.addEventListener('keyup', onKeyUp)

    // Collapsing the selection (empty click) should dismiss any open popover
    // so it doesn't strand on a now-empty selection.
    const onCursorChange = () => {
      const sel = modified.getSelection() ?? original.getSelection()
      if (!sel || sel.isEmpty()) {
        setPopover(null)
      }
    }
    const d1 = modified.onDidChangeCursorPosition(onCursorChange)
    const d2 = original.onDidChangeCursorPosition(onCursorChange)

    // Content-change: mark dirty whenever the modified-side value drifts
    // from the last-synced snapshot. Comparing against a ref (not the state)
    // avoids stale closures after a reload mutates both values under us.
    const d3 = modified.onDidChangeModelContent(() => {
      const model = modified.getModel()
      if (!model) return
      const value = model.getValue()
      setIsDirty(value !== lastSyncedContentRef.current)
    })

    editorInstance.onDidDispose(() => {
      modifiedDom?.removeEventListener('mouseup', onPointerUp)
      modifiedDom?.removeEventListener('keyup', onKeyUp)
      originalDom?.removeEventListener('mouseup', onPointerUp)
      originalDom?.removeEventListener('keyup', onKeyUp)
      d1.dispose()
      d2.dispose()
      d3.dispose()
    })
  }, [captureSelection])

  const handlePopoverSend = useCallback((message: string) => {
    onSendMessage(message)
    setPopover(null)
    onClose()
  }, [onSendMessage, onClose])

  // ── Keyboard: Esc to close, cmd+up/down for file nav, hunk nav ───────────
  // Hunk navigation has two bindings because plain n/p would type those
  // letters when Monaco has focus in edit mode:
  //   - Outside Monaco: n / p  (fast, mnemonic)
  //   - Anywhere:       ⌘] / ⌘[  (works inside the editor too)
  // ⌘↑ / ⌘↓ for file navigation works everywhere since those aren't
  // standard editor bindings.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      const inEditable = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
      const inMonaco = target.closest('.monaco-editor') !== null
      const mod = event.metaKey || event.ctrlKey

      if (event.key === 'Escape' && !inEditable) {
        // If a popover is open, its own Escape handler runs first (with
        // stopPropagation), so this branch only fires when there's no popover.
        event.preventDefault()
        onClose()
        return
      }

      // File navigation: works in and out of Monaco because ⌘↑/⌘↓ aren't
      // conflicting editor bindings on macOS.
      if (mod && event.key === 'ArrowDown') {
        event.preventDefault()
        handleJumpFile('next')
        return
      }
      if (mod && event.key === 'ArrowUp') {
        event.preventDefault()
        handleJumpFile('prev')
        return
      }

      // Hunk navigation via ⌘] / ⌘[ works anywhere, including inside the
      // editor where Monaco would otherwise swallow keys.
      if (mod && event.key === ']') {
        event.preventDefault()
        handleJumpHunk('next')
        return
      }
      if (mod && event.key === '[') {
        event.preventDefault()
        handleJumpHunk('prev')
        return
      }

      // Bare n/p shortcuts only fire outside the editor and inputs; inside
      // Monaco those letters need to actually type themselves.
      if (inEditable || inMonaco) return

      if (event.key === 'n' && !mod) {
        event.preventDefault()
        handleJumpHunk('next')
      } else if (event.key === 'p' && !mod) {
        event.preventDefault()
        handleJumpHunk('prev')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleJumpFile, handleJumpHunk, onClose])

  const isAgentBusy = agentStatus === 'running' || agentStatus === 'starting'
  const language = selectedPath ? languageForPath(selectedPath) : 'plaintext'

  return (
    <div className="fixed inset-0 bg-neutral-950 text-neutral-100 flex flex-col z-50">
      {/* Header — drag-region on macOS so the user can still reposition the
          window; interactive children opt out via no-drag. pl-20 reserves
          space for the traffic-light cluster. */}
      <div className="drag-region flex items-center gap-3 h-12 pl-20 pr-3 border-b border-neutral-800 bg-neutral-900 shrink-0">
        <div className="flex items-center gap-2 text-sm min-w-0">
          <FolderSimple weight="duotone" className="h-4 w-4 text-neutral-500 shrink-0" />
          <span className="font-medium truncate">{projectName}</span>
          <span className="text-neutral-500 shrink-0">/</span>
          <span className="text-neutral-300 truncate">{agentName}</span>
          <span className="text-neutral-600 text-xs ml-2 truncate">{branchName}</span>
        </div>
        <div className="flex-1" />
        {isAgentBusy && (
          <div className="no-drag flex items-center gap-1.5 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2 py-1 rounded shrink-0">
            <Warning weight="fill" className="h-3 w-3" />
            Agent is working — review only
          </div>
        )}
        <button
          type="button"
          onClick={() => void refreshStatus()}
          className="no-drag flex items-center gap-1.5 text-xs text-neutral-400 hover:text-neutral-200 px-2 py-1 rounded hover:bg-neutral-800"
          title="Refresh git status"
        >
          <ArrowsClockwise className="h-3.5 w-3.5" />
          Refresh
        </button>
        <div className="h-4 w-px bg-neutral-700" />
        <button
          type="button"
          onClick={onClose}
          className="no-drag flex items-center gap-1.5 text-sm text-neutral-200 hover:text-white bg-neutral-800 hover:bg-neutral-700 px-2.5 py-1 rounded-md"
          title="Back to fleet (Esc)"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
          <kbd className="ml-1 text-[10px] text-neutral-400 font-mono">Esc</kbd>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 flex min-h-0">
        {/* File list */}
        <div className="w-72 border-r border-neutral-800 flex flex-col bg-neutral-900 min-h-0">
          <div className="shrink-0 px-3 py-1.5 text-[10px] uppercase tracking-wide text-neutral-500 border-b border-neutral-800 flex items-center justify-between">
            <span>Changed files</span>
            <span className="text-neutral-600">{files.length}</span>
          </div>
          <div className="flex-1 overflow-auto min-h-0">
            {loadingStatus ? (
              <div className="flex items-center gap-2 px-3 py-4 text-xs text-neutral-500">
                <CircleNotch className="h-3.5 w-3.5 animate-spin" />
                Loading…
              </div>
            ) : statusError ? (
              <div className="px-3 py-3 text-xs text-rose-400">{statusError}</div>
            ) : files.length === 0 ? (
              <div className="px-3 py-4 text-xs text-neutral-500">No uncommitted changes.</div>
            ) : (
              <ul>
                {files.map((file) => {
                  const isSelected = file.path === selectedPath
                  const basename = file.path.split('/').pop() ?? file.path
                  const dir = file.path.slice(0, file.path.length - basename.length)
                  // Only the currently-selected file can be "dirty" — we
                  // only hold one buffer at a time. Any future multi-buffer
                  // support would need to track dirty-per-path here.
                  const rowDirty = isSelected && isDirty
                  return (
                    <li key={file.path}>
                      <button
                        type="button"
                        onClick={() => setSelectedPath(file.path)}
                        className={`w-full text-left px-3 py-1.5 flex items-center gap-2 text-xs ${
                          isSelected ? 'bg-sky-500/10 text-sky-100' : 'text-neutral-300 hover:bg-neutral-800/50'
                        }`}
                      >
                        <span
                          className={`w-3 text-center font-mono text-[10px] font-semibold ${STATUS_COLORS[file.status] ?? 'text-neutral-400'}`}
                          title={file.status}
                        >
                          {STATUS_GLYPHS[file.status] ?? '•'}
                        </span>
                        <FileText weight="light" className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
                        <span className="truncate flex-1">
                          {dir && <span className="text-neutral-500">{dir}</span>}
                          <span>{basename}</span>
                        </span>
                        {rowDirty && (
                          <span className="text-amber-400 text-[10px]" title="Unsaved changes">●</span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          <div className="shrink-0 border-t border-neutral-800 px-3 py-2 text-[10px] text-neutral-500 leading-relaxed bg-neutral-900">
            <div className="flex items-center gap-1 flex-wrap">
              <kbd className="px-1 py-0.5 bg-neutral-800 rounded font-mono">⌘]</kbd>
              <span>next hunk</span>
              <span className="text-neutral-700 mx-0.5">·</span>
              <kbd className="px-1 py-0.5 bg-neutral-800 rounded font-mono">⌘[</kbd>
              <span>prev</span>
              <span className="text-neutral-700 mx-0.5">·</span>
              <kbd className="px-1 py-0.5 bg-neutral-800 rounded font-mono">⌘↓</kbd>
              <span>next file</span>
              <span className="text-neutral-700 mx-0.5">·</span>
              <kbd className="px-1 py-0.5 bg-neutral-800 rounded font-mono">⌘S</kbd>
              <span>save</span>
            </div>
          </div>
        </div>

        {/* Diff pane */}
        <div className="flex-1 flex flex-col min-w-0">
          {selectedFile ? (
            <>
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-neutral-800 bg-neutral-900/50 text-xs">
                <span className={`font-mono font-semibold ${STATUS_COLORS[selectedFile.status] ?? 'text-neutral-400'}`}>
                  {STATUS_GLYPHS[selectedFile.status] ?? '•'}
                </span>
                {/* Dirty indicator: bullet that only appears when the buffer
                    differs from disk. Common editor idiom — saves a word of
                    UI real estate vs "Unsaved". */}
                {isDirty && (
                  <span className="text-amber-400" title="Unsaved changes">
                    ●
                  </span>
                )}
                <span className="text-neutral-200 truncate">{selectedFile.path}</span>
                {selectedFile.oldPath && (
                  <span className="text-neutral-500 text-[10px]">← {selectedFile.oldPath}</span>
                )}
                {/* Save state chip. Renders inline so it's visible without
                    stealing focus or requiring a toast system. */}
                <SaveStateBadge state={saveState} error={saveError} />
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => handleJumpHunk('prev')}
                  className="p-1 rounded hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200"
                  title="Previous hunk (⌘[ or p)"
                >
                  <CaretUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => handleJumpHunk('next')}
                  className="p-1 rounded hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200"
                  title="Next hunk (⌘] or n)"
                >
                  <CaretDown className="h-3.5 w-3.5" />
                </button>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => void saveFile(false)}
                    disabled={!isDirty || saveState === 'saving'}
                    className="flex items-center gap-1 ml-1 px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-[10px] font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                    title={isDirty ? 'Save (⌘S)' : 'No changes to save'}
                  >
                    <FloppyDisk className="h-3 w-3" />
                    Save
                  </button>
                )}
              </div>
              {/* External-change banner: shown when the watcher detects an
                  on-disk mutation while the user has unsaved edits. The user
                  picks: reload (lose their edits) or keep (overwrite agent's
                  edits on next save). Clean-buffer case reloads silently. */}
              {externalChange && (
                <div className="flex items-center gap-3 px-3 py-2 border-b border-amber-500/30 bg-amber-500/10 text-xs text-amber-200">
                  <Warning weight="fill" className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1">
                    This file changed on disk. Your unsaved edits are still in the editor.
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setExternalChange(null)
                      if (selectedPath) void loadDiff(selectedPath)
                    }}
                    className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 text-[11px] font-medium"
                  >
                    Reload, discard mine
                  </button>
                  <button
                    type="button"
                    onClick={() => setExternalChange(null)}
                    className="px-2 py-0.5 rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-100 text-[11px] font-medium"
                    title="Keep your edits. Next save will overwrite the external version."
                  >
                    Keep mine
                  </button>
                </div>
              )}
              <div className="flex-1 min-h-0">
                {loadingDiff ? (
                  <div className="flex items-center justify-center h-full text-neutral-500 text-sm gap-2">
                    <CircleNotch className="h-4 w-4 animate-spin" />
                    Loading diff…
                  </div>
                ) : diffError ? (
                  <div className="p-4 text-sm text-rose-400">{diffError}</div>
                ) : diffSides ? (
                  <DiffEditor
                    original={diffSides.before}
                    modified={diffSides.after}
                    language={language}
                    theme="vs-dark"
                    onMount={handleDiffMount}
                    options={{
                      // Modified (right) side is editable when the file is
                      // editable on disk; original (left, HEAD) is always
                      // read-only. Editing historical content doesn't fit
                      // the review workflow.
                      readOnly: !canEdit,
                      originalEditable: false,
                      renderSideBySide: true,
                      // Hide Monaco's inline per-hunk revert arrows. They
                      // silently overwrite edits on a single click with no
                      // confirmation, which is hostile here. Users still
                      // have ⌘Z for fine-grained undo and the "Reload,
                      // discard mine" banner for whole-file revert.
                      renderMarginRevertIcon: false,
                      minimap: { enabled: false },
                      automaticLayout: true,
                      fontSize: 12,
                      lineNumbers: 'on',
                      scrollBeyondLastLine: false,
                      renderWhitespace: 'none',
                      wordWrap: 'off'
                    }}
                  />
                ) : null}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-neutral-500 text-sm">
              {files.length === 0 ? 'Nothing to review.' : 'Select a file to see the diff.'}
            </div>
          )}
        </div>
      </div>

      {popover && (
        <HighlightAskPopover
          anchor={popover.anchor}
          selection={popover.selection}
          onSend={handlePopoverSend}
          onClose={() => setPopover(null)}
        />
      )}

      {conflictModal && selectedPath && (
        <ConflictModal
          filePath={selectedPath}
          currentMtimeMs={conflictModal.currentMtimeMs}
          onOverwrite={() => {
            setConflictModal(null)
            void saveFile(true)
          }}
          onDiscardMine={() => {
            setConflictModal(null)
            if (selectedPath) void loadDiff(selectedPath)
          }}
          onCancel={() => {
            setConflictModal(null)
            // Reset save state so the next keystroke re-arms autosave.
            setSaveState('idle')
          }}
        />
      )}
    </div>
  )
}

/** Small inline indicator for save state. Lives in the file header so it's
 *  always visible during the autosave cycle. */
function SaveStateBadge({ state, error }: { state: 'idle' | 'saving' | 'saved' | 'conflict' | 'error'; error: string | null }) {
  if (state === 'idle') return null
  if (state === 'saving') {
    return (
      <span className="flex items-center gap-1 text-[10px] text-neutral-400">
        <CircleNotch className="h-3 w-3 animate-spin" />
        Saving…
      </span>
    )
  }
  if (state === 'saved') {
    return (
      <span className="flex items-center gap-1 text-[10px] text-emerald-400">
        <CheckCircle weight="fill" className="h-3 w-3" />
        Saved
      </span>
    )
  }
  if (state === 'conflict') {
    return (
      <span className="flex items-center gap-1 text-[10px] text-amber-400">
        <Warning weight="fill" className="h-3 w-3" />
        Conflict
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1 text-[10px] text-rose-400" title={error ?? undefined}>
      <Warning weight="fill" className="h-3 w-3" />
      Save failed
    </span>
  )
}

/** Modal shown when a save is rejected because the file on disk changed
 *  since it was read. The user picks between overwriting (clobber disk),
 *  discarding their edits (reload from disk), or cancelling (leave the
 *  buffer dirty so they can keep editing and decide later). */
function ConflictModal({
  filePath,
  currentMtimeMs,
  onOverwrite,
  onDiscardMine,
  onCancel
}: {
  filePath: string
  currentMtimeMs: number | null
  onOverwrite: () => void
  onDiscardMine: () => void
  onCancel: () => void
}) {
  const diskAge = currentMtimeMs ? Math.max(0, Date.now() - currentMtimeMs) : null
  const ageLabel = diskAge === null ? 'unknown time' : diskAge < 1000 ? 'just now' : diskAge < 60_000 ? `${Math.floor(diskAge / 1000)}s ago` : `${Math.floor(diskAge / 60_000)}m ago`

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60" onClick={onCancel}>
      <div
        className="w-[480px] rounded-lg border border-neutral-700 bg-neutral-900 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-neutral-800">
          <Warning weight="fill" className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-medium">Save conflict</span>
        </div>
        <div className="px-4 py-3 space-y-2 text-sm text-neutral-200">
          <p>
            <code className="font-mono text-xs bg-neutral-950 px-1 py-0.5 rounded">{filePath}</code> was
            modified on disk {ageLabel} while you were editing.
          </p>
          <p className="text-neutral-400 text-xs">
            Your edits are still in the buffer. Pick how to reconcile:
          </p>
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-neutral-800">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded text-xs text-neutral-300 hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onDiscardMine}
            className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-100 text-xs font-medium"
            title="Reload from disk, losing your edits"
          >
            Discard mine
          </button>
          <button
            type="button"
            onClick={onOverwrite}
            className="px-3 py-1.5 rounded bg-amber-500/80 hover:bg-amber-500 text-neutral-900 text-xs font-medium"
            title="Write your version, overwriting the external changes"
          >
            Overwrite disk
          </button>
        </div>
      </div>
    </div>
  )
}
