import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react'
import {
  X,
  Check,
  XCircle,
  ArrowSquareOut,
  GitPullRequest,
  Terminal,
  Wrench,
  CircleNotch,
  CaretDown,
  CaretRight,
  Trash,
  ChatCircleDots,
  PaperPlaneTilt,
  ArrowUp,
  Stop,
  Paperclip,
  ArrowLineUpRight,
  Link,
  Plus,
  Rocket,
  Lightning,
  Code,
  CheckCircle,
  Warning,
  ArrowsInLineHorizontal,
  Copy,
  SlidersHorizontal,
} from '@phosphor-icons/react'
import type { AgentRuntime, Message, LabelDefinition, LabelColorKey } from '../types'
import { formatBranchLabel } from '../types'
import type { LivePermission, LiveQuestion } from '../hooks/useAgentStore'
import { UNRESOLVED_MODEL_LABEL } from '../hooks/placeholderLaunch'
import {
  loadSettings,
  OUTPUT_VERBOSITY_OPTIONS,
  SETTINGS_CHANGED_EVENT,
  isQuickActionValid,
  type OutputVerbosity,
  type QuickAction,
  type QuickActionIcon
} from '../data/settings'
import { loadAgentOutputVerbosity, saveAgentOutputVerbosity } from '../data/agentSettings'
import { useImageAttachments } from '../hooks/useImageAttachments'
import { useEditorLabel } from '../hooks/useEditorLabel'
import { getVariantOptionsForModel, useModelOptions } from '../hooks/useModelOptions'
import { StatusBadge } from './StatusBadge'
import { LabelDropdown } from './LabelDropdown'
import { ContextUsageIndicator } from './ContextUsageIndicator'
import { PortaledMenu } from './PortaledMenu'
import { TextInputModal } from './TextInputModal'
import { Markdown } from './Markdown'
import { FilesChanged } from './FilesChanged'
import { CollapsibleSubagentProgress, ToolsUsage } from './ToolsUsage'
import { EventLog } from './EventLog'
import { SelectField } from './SelectField'
import { findLastTranscriptMessageId } from '../lib/last-message'

import type { FileChange } from './FilesChanged'
import type { ToolCall } from './ToolsUsage'
import type { EventEntry } from './EventLog'

export type { FileChange, ToolCall, EventEntry }

const quickActionIconMap: Record<QuickActionIcon, typeof Lightning> = {
  'git-pull-request': GitPullRequest,
  'rocket': Rocket,
  'lightning': Lightning,
  'terminal': Terminal,
  'code': Code,
  'check-circle': CheckCircle,
  'paper-plane': PaperPlaneTilt,
  'wrench': Wrench,
}

const DRAWER_WIDTH_KEY = 'oc-orchestrator:drawer-width'
const DEFAULT_DRAWER_WIDTH = 600
const MIN_DRAWER_WIDTH = 400
const MAX_DRAWER_WIDTH = 1000
const INPUT_HEIGHT_KEY = 'oc-orchestrator:input-height'
const DEFAULT_INPUT_HEIGHT_RATIO = 0.3 // 30% of window height
const MIN_INPUT_HEIGHT = 100
const MAX_INPUT_HEIGHT = 500
const VISIBLE_MESSAGE_WINDOW = 50
const LOAD_MORE_INCREMENT = 50
const NEAR_BOTTOM_THRESHOLD = 80
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'])

// Persists unsent input text per agent across drawer open/close cycles.
// Module-level so it survives component unmount (the drawer is conditionally rendered).
const draftInputs = new Map<string, string>()

// Stores sent message history per agent for up/down arrow cycling.
// Seeded from existing user messages when first accessed, then appended on each send.
const inputHistories = new Map<string, string[]>()

function loadDrawerWidth(): number {
  try {
    const stored = localStorage.getItem(DRAWER_WIDTH_KEY)
    if (stored) {
      const width = Number(stored)
      if (width >= MIN_DRAWER_WIDTH && width <= MAX_DRAWER_WIDTH) return width
    }
  } catch { /* ignore */ }
  return DEFAULT_DRAWER_WIDTH
}

function loadInputHeight(): number {
  try {
    const stored = localStorage.getItem(INPUT_HEIGHT_KEY)
    if (stored) {
      const height = Number(stored)
      if (height >= MIN_INPUT_HEIGHT && height <= MAX_INPUT_HEIGHT) return height
    }
  } catch { /* ignore */ }
  return Math.max(MIN_INPUT_HEIGHT, Math.round(window.innerHeight * DEFAULT_INPUT_HEIGHT_RATIO))
}

type TabKey = 'transcript' | 'todos' | 'files' | 'tools' | 'events' | 'config'

type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'

interface AgentTodo {
  content: string
  status: TodoStatus
  priority?: string
}

const todoStatusLabels: Record<TodoStatus, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled'
}

const todoStatusStyles: Record<TodoStatus, string> = {
  pending: 'border-kumo-line bg-kumo-control text-kumo-subtle',
  in_progress: 'border-kumo-link/35 bg-kumo-interact/12 text-kumo-link',
  completed: 'border-kumo-success/30 bg-kumo-success/12 text-kumo-success',
  cancelled: 'border-kumo-line bg-kumo-fill text-kumo-subtle/70'
}

function isTodoStatus(value: unknown): value is TodoStatus {
  return value === 'pending'
    || value === 'in_progress'
    || value === 'completed'
    || value === 'cancelled'
}

function parseTodos(input: string | undefined): AgentTodo[] {
  if (!input) return []

  try {
    const parsed = JSON.parse(input) as { todos?: unknown }
    if (!Array.isArray(parsed.todos)) return []

    return parsed.todos.flatMap((todo): AgentTodo[] => {
      if (!todo || typeof todo !== 'object') return []
      const item = todo as Record<string, unknown>
      if (typeof item.content !== 'string' || !item.content.trim()) return []

      return [{
        content: item.content,
        status: isTodoStatus(item.status) ? item.status : 'pending',
        priority: typeof item.priority === 'string' ? item.priority : undefined
      }]
    })
  } catch {
    return []
  }
}

export interface ChatCommand {
  command: string
  description: string
}

export interface AgentConfigItem {
  name: string
  description?: string
}

interface DetailDrawerProps {
  agent: AgentRuntime
  /** Absolute path to the agent's workspace (worktree or repo root). Lives on
   *  the store's LiveAgent rather than AgentRuntime, so it's passed in. */
  workspacePath?: string
  messages: Message[]
  permission?: LivePermission | null
  question?: LiveQuestion | null
  files?: FileChange[]
  tools?: ToolCall[]
  events?: EventEntry[]
  commands?: ChatCommand[]
  agentConfigs?: AgentConfigItem[]
  sessionNotice?: string
  /**
   * When set, jumps the transcript to a specific anchor. `seq` must bump for
   * each request so repeated clicks retrigger the scroll even when the target
   * is unchanged.
   */
  scrollRequest?: { target: 'last-user-message' | 'last-assistant-message' | 'bottom'; seq: number } | null
  onClose: () => void
  onSendMessage?: (text: string, attachments?: Array<{ mime: string; dataUrl: string; filename?: string }>) => void
  onApprove?: () => void
  onApproveAlways?: () => void
  onDeny?: () => void
  onReplyQuestion?: (answers: string[][]) => void
  onRejectQuestion?: () => void
  onAbort?: () => void
  onRemove?: () => void
  onCreatePr?: () => void
  onQuickAction?: (action: QuickAction) => void
  onOpenQuickActionSettings?: () => void
  onSetPrUrl?: (prUrl: string | null) => void
  onOpenInEditor?: () => void
  /** Open the full-window Workspace view (git-status-backed diff viewer +
   *  highlight-to-ask) for this agent. Offered alongside the external-editor
   *  option so users can review work inline without leaving the app. Accepts
   *  an optional file path to pre-select (used when the user clicks a row
   *  in Files Changed). */
  onOpenWorkspace?: (filePath?: string) => void
  onChangeModel?: (modelPath: string, variant?: string) => Promise<boolean>
  onOpenTerminal?: () => void
  onToggleLabel?: (labelId: string) => void
  onClearLabels?: () => void
  allLabels?: LabelDefinition[]
  onCreateLabel?: (name: string, colorKey: LabelColorKey) => Promise<LabelDefinition | null>
  onDeleteLabel?: (id: string) => Promise<boolean>
  /** Dismiss the error banner without any corrective action. */
  onDismissError?: () => void
  /** Trigger server-side compaction of the transcript. Used from the banner
   *  (when a ContextOverflowError surfaces) and from the always-visible
   *  Compact action button. */
  onCompact?: () => void
  /** Recovery for sessions too large to compact — reset to a fresh session
   *  that re-orients itself from git history. */
  onStartFreshSession?: () => void
}

export const DetailDrawer = memo(function DetailDrawer({
  agent,
  workspacePath,
  messages,
  permission,
  question,
  files = [],
  tools = [],
  events = [],
  commands = [],
  agentConfigs = [],
  sessionNotice,
  scrollRequest,
  onClose,
  onSendMessage,
  onApprove,
  onApproveAlways,
  onDeny,
  onReplyQuestion,
  onRejectQuestion,
  onAbort,
  onRemove,
  onCreatePr,
  onQuickAction,
  onOpenQuickActionSettings,
  onSetPrUrl,
  onOpenInEditor,
  onOpenWorkspace,
  onChangeModel,
  onOpenTerminal,
  onToggleLabel,
  onClearLabels,
  allLabels = [],
  onCreateLabel,
  onDeleteLabel,
  onDismissError,
  onCompact,
  onStartFreshSession
}: DetailDrawerProps) {
  const [inputText, _setInputText] = useState(() => draftInputs.get(agent.id) ?? '')
  const setInputText = useCallback((text: string) => {
    _setInputText(text)
    if (text) draftInputs.set(agent.id, text)
    else draftInputs.delete(agent.id)
  }, [agent.id])
  const [activeTab, setActiveTab] = useState<TabKey>('transcript')
  const [isVisible, setIsVisible] = useState(false)
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)
  const [drawerWidth, setDrawerWidth] = useState(loadDrawerWidth)
  const [inputHeight, setInputHeight] = useState(loadInputHeight)
  const [agentPickerDismissed, setAgentPickerDismissed] = useState(false)
  const [agentPickerIndex, setAgentPickerIndex] = useState(0)
  const [commandPickerIndex, setCommandPickerIndex] = useState(0)
  const [cursorPos, setCursorPos] = useState(0)
  const [visibleMessageCount, setVisibleMessageCount] = useState(VISIBLE_MESSAGE_WINDOW)
  const [showPrLinkModal, setShowPrLinkModal] = useState(false)

  // Input history cycling: -1 = not browsing, 0+ = offset from most recent
  const historyIndexRef = useRef(-1)
  const savedDraftRef = useRef('')

  if (!inputHistories.has(agent.id)) {
    const userTexts = messages
      .filter((m) => m.role === 'user' && m.content.trim())
      .map((m) => m.content.trim())
    inputHistories.set(agent.id, userTexts)
  }

  // Reset state when switching agents within an open drawer
  const prevAgentIdRef = useRef(agent.id)
  if (prevAgentIdRef.current !== agent.id) {
    prevAgentIdRef.current = agent.id
    setVisibleMessageCount(VISIBLE_MESSAGE_WINDOW)
    _setInputText(draftInputs.get(agent.id) ?? '')
    historyIndexRef.current = -1
  }

  const hiddenCount = Math.max(0, messages.length - visibleMessageCount)
  const visibleMessages = hiddenCount > 0 ? messages.slice(hiddenCount) : messages

  const handleLoadMore = useCallback(() => {
    setVisibleMessageCount((prev) => prev + LOAD_MORE_INCREMENT)
  }, [])

  // Global settings provide the default; a drawer choice is persisted per agent.
  const [outputVerbosity, setOutputVerbosity] = useState<OutputVerbosity>(() =>
    loadAgentOutputVerbosity(agent.sessionId ?? agent.id) ?? loadSettings().outputVerbosity
  )
  const [quickActions, setQuickActions] = useState(() => loadSettings().quickActions)
  const editorLabel = useEditorLabel()
  useEffect(() => {
    const onSettingsChanged = () => {
      const s = loadSettings()
      if (!loadAgentOutputVerbosity(agent.sessionId ?? agent.id)) setOutputVerbosity(s.outputVerbosity)
      setQuickActions(s.quickActions)
    }
    window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
  }, [agent.id, agent.sessionId])

  const handleOutputVerbosityChange = useCallback((value: OutputVerbosity) => {
    setOutputVerbosity(value)
    saveAgentOutputVerbosity(agent.sessionId ?? agent.id, value)
  }, [agent.id, agent.sessionId])
  const {
    attachments, isDragOver, fileInputRef,
    removeAttachment, clearAttachments,
    handlePaste, handleDragOver, handleDragEnter, handleDragLeave, handleDrop, handleFileInputChange
  } = useImageAttachments()
  const transcriptScrollRef = useRef<HTMLDivElement>(null)
  const transcriptContentRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const followBottomRef = useRef(true)
  const isResizingRef = useRef(false)
  const isResizingVerticalRef = useRef(false)

  // Map of message id -> DOM node for scroll-to-message. Populated by
  // MessageBubble via registerRef callback.
  const messageNodesRef = useRef<Map<string, HTMLElement>>(new Map())
  const registerMessageRef = useCallback((id: string, node: HTMLElement | null) => {
    if (node) messageNodesRef.current.set(id, node)
    else messageNodesRef.current.delete(id)
  }, [])

  const handleResizeStart = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    isResizingRef.current = true
    const startX = event.clientX
    const startWidth = drawerWidth

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX
      const newWidth = Math.min(MAX_DRAWER_WIDTH, Math.max(MIN_DRAWER_WIDTH, startWidth + delta))
      setDrawerWidth(newWidth)
    }

    const handleMouseUp = () => {
      isResizingRef.current = false
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setDrawerWidth((final) => {
        localStorage.setItem(DRAWER_WIDTH_KEY, String(final))
        return final
      })
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [drawerWidth])

  const handleVerticalResizeStart = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    isResizingVerticalRef.current = true
    const startY = event.clientY
    const startHeight = inputHeight

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = startY - moveEvent.clientY
      const newHeight = Math.min(MAX_INPUT_HEIGHT, Math.max(MIN_INPUT_HEIGHT, startHeight + delta))
      setInputHeight(newHeight)
    }

    const handleMouseUp = () => {
      isResizingVerticalRef.current = false
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setInputHeight((final: number) => {
        localStorage.setItem(INPUT_HEIGHT_KEY, String(final))
        return final
      })
    }

    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [inputHeight])

  const trimmedInput = inputText.trim().toLowerCase()

  // Only suggest commands while the user is still typing a single-token command
  // (no space or newline yet). Once they add a space, they've committed to that
  // command and are typing arguments — or the next Enter should submit.
  const isTypingCommand = inputText.startsWith('/') && !inputText.includes(' ') && !inputText.includes('\n')
  const matchingCommands = useMemo(
    () => isTypingCommand
      ? commands.filter(({ command }) => command.startsWith(trimmedInput))
      : [],
    [isTypingCommand, trimmedInput, commands]
  )

  const showCommandAutocomplete = matchingCommands.length > 0 && trimmedInput.length > 0

  // ── @ Agent mention detection ──
  // Find the @mention being typed at or before the cursor position.
  // We look for "@" followed by optional word characters, where the cursor
  // is within or right after this token.
  const agentMentionResult = useMemo(() => {
    if (agentConfigs.length === 0) return null
    const textBeforeCursor = inputText.slice(0, cursorPos)
    const match = textBeforeCursor.match(/@(\w*)$/)
    if (!match) return null
    const start = textBeforeCursor.length - match[0].length
    return { query: match[1].toLowerCase(), start, end: cursorPos }
  }, [agentConfigs.length, inputText, cursorPos])

  const agentMention = !agentPickerDismissed ? agentMentionResult : null
  const matchingAgents = useMemo(
    () => agentMention
      ? agentConfigs.filter((cfg) => cfg.name.toLowerCase().startsWith(agentMention.query))
      : [],
    [agentMention, agentConfigs]
  )
  const showAgentPicker = matchingAgents.length > 0 && !showCommandAutocomplete

  const canReplyViaChat = !!question
    && question.questions.length === 1
    && question.questions[0].custom !== false

  let inputPlaceholder = 'Send a message to this agent... Type / for commands, @ for agents.'
  if (isDragOver) inputPlaceholder = 'Drop image here...'
  else if (canReplyViaChat) inputPlaceholder = 'Type your answer to the question above...'

  // Slide-in animation on mount
  useEffect(() => {
    const frame = requestAnimationFrame(() => setIsVisible(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    textareaRef.current?.focus()
  }, [agent.id])

  const scrollToBottom = (el: HTMLDivElement) => { el.scrollTop = el.scrollHeight }

  const reengageFollow = () => {
    followBottomRef.current = true
    setShowJumpToLatest(false)
    const container = transcriptScrollRef.current
    if (container) scrollToBottom(container)
  }

  // Pin to bottom whenever transcript content resizes. Catches all height
  // changes (new messages, streaming, status indicators, markdown reflow)
  // without enumerating React deps. Tears down and re-attaches on tab
  // switch, which also resets follow state.
  useEffect(() => {
    if (activeTab !== 'transcript') return
    const container = transcriptScrollRef.current
    const content = transcriptContentRef.current
    if (!container || !content) return

    followBottomRef.current = true
    setShowJumpToLatest(false)

    const ro = new ResizeObserver(() => {
      if (followBottomRef.current) {
        scrollToBottom(container)
      } else {
        const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
        if (distanceFromBottom > NEAR_BOTTOM_THRESHOLD) {
          setShowJumpToLatest(true)
        }
      }
    })
    ro.observe(content)

    requestAnimationFrame(() => scrollToBottom(container))
    return () => ro.disconnect()
  }, [activeTab])

  // Only wheel, scrollbar drag, and keyboard navigation can disengage
  // auto-follow — programmatic scrolls and layout shifts cannot.
  useEffect(() => {
    if (activeTab !== 'transcript') return
    const container = transcriptScrollRef.current
    if (!container) return

    const checkDetach = () => {
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
      const nearBottom = distanceFromBottom < NEAR_BOTTOM_THRESHOLD
      followBottomRef.current = nearBottom
      setShowJumpToLatest(!nearBottom)
    }

    const onWheel = () => requestAnimationFrame(checkDetach)

    const onPointerDown = (e: PointerEvent) => {
      if (e.offsetX < container.clientWidth) return
      const onPointerUp = () => {
        container.removeEventListener('scroll', checkDetach)
        window.removeEventListener('pointerup', onPointerUp)
      }
      container.addEventListener('scroll', checkDetach)
      window.addEventListener('pointerup', onPointerUp)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (SCROLL_KEYS.has(e.key)) requestAnimationFrame(checkDetach)
    }

    container.addEventListener('wheel', onWheel, { passive: true })
    container.addEventListener('pointerdown', onPointerDown)
    container.addEventListener('keydown', onKeyDown)
    return () => {
      container.removeEventListener('wheel', onWheel)
      container.removeEventListener('pointerdown', onPointerDown)
      container.removeEventListener('keydown', onKeyDown)
    }
  }, [activeTab])

  // Scroll-to-target: react to scrollRequest.seq changes. Triggered when the
  // user clicks the "Last Message" cell in the fleet table or sends from the
  // workspace popover.
  const lastHandledScrollSeqRef = useRef<number>(-1)
  useEffect(() => {
    if (!scrollRequest) return
    if (scrollRequest.seq === lastHandledScrollSeqRef.current) return
    lastHandledScrollSeqRef.current = scrollRequest.seq

    if (activeTab !== 'transcript') setActiveTab('transcript')

    if (scrollRequest.target === 'bottom') {
      // Snap to the very bottom and re-engage follow-mode so the streaming
      // reply auto-scrolls into view as it arrives. This is what we want
      // after sending from the workspace popover — the user just sent a
      // message and wants to watch the agent answer.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        followBottomRef.current = true
        setShowJumpToLatest(false)
        const container = transcriptScrollRef.current
        if (container) container.scrollTop = container.scrollHeight
      }))
      return
    }

    const targetId = findLastTranscriptMessageId(messages, scrollRequest.target)
    if (!targetId) return
    const targetIndex = messages.findIndex((message) => message.id === targetId)
    if (targetIndex < 0) return

    // Expand the visible window if the target is outside it so the node renders.
    const neededCount = messages.length - targetIndex
    if (neededCount > visibleMessageCount) {
      setVisibleMessageCount(neededCount)
    }

    // Two rAFs: first waits for setActiveTab / setVisibleMessageCount to
    // commit, second waits for the tab-switch effect's own rAF to run so
    // our followBottom=false wins (otherwise streaming output would yank us
    // back to the bottom immediately after jumping).
    requestAnimationFrame(() => requestAnimationFrame(() => {
      followBottomRef.current = false
      setShowJumpToLatest(true)
      messageNodesRef.current.get(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }))
  }, [scrollRequest, messages, activeTab, visibleMessageCount])

  const handleInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(event.target.value)
    setCursorPos(event.target.selectionStart)
    // Reset agent picker dismissed state when text changes
    // so the picker can reappear on new @ triggers
    setAgentPickerDismissed(false)
    setAgentPickerIndex(0)
    setCommandPickerIndex(0)
  }

  const insertAgentMention = (agentName: string) => {
    if (!agentMention) return
    const before = inputText.slice(0, agentMention.start)
    const after = inputText.slice(agentMention.end)
    const newText = `${before}@${agentName} ${after}`
    setInputText(newText)
    setAgentPickerDismissed(false)
    setAgentPickerIndex(0)
    // Move cursor to after the inserted mention
    requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (textarea) {
        const cursorPos = agentMention.start + agentName.length + 2 // @ + name + space
        textarea.selectionStart = cursorPos
        textarea.selectionEnd = cursorPos
        textarea.focus()
      }
    })
  }

  const handleSend = () => {
    const trimmed = inputText.trim()
    if ((!trimmed && attachments.length === 0) || !onSendMessage) return
    if (trimmed) {
      const history = inputHistories.get(agent.id) ?? []
      if (history[history.length - 1] !== trimmed) {
        history.push(trimmed)
        if (!inputHistories.has(agent.id)) inputHistories.set(agent.id, history)
      }
    }
    historyIndexRef.current = -1
    onSendMessage(trimmed, attachments.length > 0 ? attachments : undefined)
    setInputText('')
    clearAttachments()
    requestAnimationFrame(reengageFollow)
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    // ── Agent picker keyboard handling ──
    if (showAgentPicker) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setAgentPickerDismissed(true)
        return
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault()
        const selected = matchingAgents[agentPickerIndex]
        if (selected) insertAgentMention(selected.name)
        return
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setAgentPickerIndex((prev) => (prev + 1) % matchingAgents.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setAgentPickerIndex((prev) => (prev - 1 + matchingAgents.length) % matchingAgents.length)
        return
      }
    }

    // ── Command autocomplete keyboard handling ──
    //
    // When the user is already navigating input history (historyIndexRef >= 0),
    // skip arrow-key handling so ArrowUp/ArrowDown continue cycling history
    // instead of getting trapped on the popup. Tab/Enter/Escape are still
    // explicit "act on the popup" intents and remain handled.
    if (showCommandAutocomplete) {
      const navigatingHistory = historyIndexRef.current >= 0
      if (event.key === 'Escape') {
        event.preventDefault()
        setInputText('')
        return
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault()
        const selected = matchingCommands[commandPickerIndex]
        if (selected) setInputText(`${selected.command} `)
        return
      }
      if (event.key === 'ArrowDown' && !navigatingHistory) {
        event.preventDefault()
        setCommandPickerIndex((prev) => (prev + 1) % matchingCommands.length)
        return
      }
      if (event.key === 'ArrowUp' && !navigatingHistory) {
        event.preventDefault()
        setCommandPickerIndex((prev) => (prev - 1 + matchingCommands.length) % matchingCommands.length)
        return
      }
    }

    // ── Input history cycling (ArrowUp/ArrowDown) ──
    //
    // Sequence the user expects when pressing ArrowUp repeatedly:
    //   1. If on a multiline draft and below line 1 → step up one line (native).
    //   2. Once on line 1 but not at column 0 → snap cursor to position 0.
    //   3. Already at position 0 → load previous history entry, cursor at 0.
    //   4. No more history → keep cursor pinned at 0.
    // ArrowDown mirrors this toward the end of the buffer.
    const history = inputHistories.get(agent.id)
    if (history && history.length > 0) {
      const textarea = event.currentTarget as HTMLTextAreaElement
      const { value, selectionStart, selectionEnd } = textarea
      const noSelection = selectionStart === selectionEnd
      const onFirstLine = noSelection && !value.slice(0, selectionStart).includes('\n')
      const onLastLine = noSelection && !value.slice(selectionEnd).includes('\n')
      const atStart = noSelection && selectionStart === 0
      const atEnd = noSelection && selectionEnd === value.length
      const fromEnd = (i: number) => history[history.length - 1 - i]
      const setCursor = (pos: number) => {
        requestAnimationFrame(() => {
          const ta = textareaRef.current
          if (ta) {
            ta.selectionStart = pos
            ta.selectionEnd = pos
          }
        })
      }

      if (event.key === 'ArrowUp' && onFirstLine) {
        // On line 1 but not column 0 → snap to start; let the next ArrowUp cycle.
        if (!atStart) {
          event.preventDefault()
          setCursor(0)
          return
        }
        // At position 0 → cycle to previous history entry.
        const next = historyIndexRef.current + 1
        if (next < history.length) {
          event.preventDefault()
          if (historyIndexRef.current === -1) savedDraftRef.current = inputText
          historyIndexRef.current = next
          const entry = fromEnd(next)
          setInputText(entry)
          setCursor(0)
        } else {
          // No more history; keep cursor pinned at start.
          event.preventDefault()
        }
        return
      }

      if (event.key === 'ArrowDown' && onLastLine) {
        // On last line but not at the very end → snap to end first.
        if (!atEnd) {
          event.preventDefault()
          setCursor(value.length)
          return
        }
        // At end → cycle forward through history (toward the current draft).
        if (historyIndexRef.current >= 0) {
          event.preventDefault()
          historyIndexRef.current -= 1
          const entry = historyIndexRef.current < 0 ? savedDraftRef.current : fromEnd(historyIndexRef.current)
          setInputText(entry)
          setCursor(entry.length)
        } else {
          // No newer history; keep cursor pinned at end.
          event.preventDefault()
        }
        return
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSend()
    }
  }

  const handleOverlayClick = (event: React.MouseEvent) => {
    if (event.target === overlayRef.current) {
      onClose()
    }
  }

  const handleCloseWithAnimation = () => {
    setIsVisible(false)
    setTimeout(onClose, 200)
  }

  // Dedupe files by path so the tab badge matches what the user sees in the
  // list. Multiple SSE events for the same file (e.g. agent edits foo.ts
  // five times) would otherwise inflate the count even though FilesChanged
  // itself collapses them on render.
  const uniqueFileCount = new Set(files.map((file) => file.path)).size

  const latestTodos = useMemo(() => {
    for (let i = tools.length - 1; i >= 0; i--) {
      const tool = tools[i]
      if (tool.name.toLowerCase() === 'todowrite') {
        return parseTodos(tool.input)
      }
    }
    return []
  }, [tools])

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: 'transcript', label: 'Transcript', count: messages.length },
    { key: 'todos', label: 'TODO', count: latestTodos.length },
    { key: 'files', label: 'Files Changed', count: uniqueFileCount },
    { key: 'tools', label: 'Tools', count: tools.length },
    { key: 'events', label: 'Events', count: events.length },
    { key: 'config', label: 'Config' }
  ]

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className={`fixed inset-0 z-50 transition-colors duration-200 ${
        isVisible ? 'bg-black/30' : 'bg-transparent'
      }`}
    >
      <div
        style={{ width: drawerWidth }}
        className={`absolute top-0 right-0 h-full bg-kumo-elevated border-l border-kumo-line flex flex-col shadow-[-8px_0_32px_rgba(0,0,0,0.4)] transition-transform duration-200 ease-out ${
          isVisible ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Resize handle */}
        <div
          onMouseDown={handleResizeStart}
          className="absolute top-0 left-0 w-1.5 h-full cursor-col-resize z-10 group"
        >
          <div className="w-px h-full mx-auto group-hover:bg-kumo-brand/50 transition-colors" />
        </div>

        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-kumo-line shrink-0">
          <button
            onClick={handleCloseWithAnimation}
            className="w-6 h-6 flex items-center justify-center border border-kumo-line rounded-md text-kumo-subtle hover:text-kumo-default hover:bg-kumo-fill transition-colors shrink-0"
          >
            <X size={12} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-xs text-kumo-strong truncate">{agent.name}</div>
            <div className="flex items-center gap-1 text-[10px] text-kumo-subtle min-w-0">
              {agent.isWorktree && (
                <span className="shrink-0 px-1 py-px rounded bg-kumo-brand/10 text-kumo-brand text-[9px] font-medium leading-tight">
                  WT
                </span>
              )}
              <span className="truncate">
                {agent.projectName} · {formatBranchLabel(agent) || agent.taskSummary.slice(0, 40)}
              </span>
              {workspacePath && <CopyPathButton path={workspacePath} />}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {agent.model !== UNRESOLVED_MODEL_LABEL ? (
              <button
                onClick={() => setActiveTab('config')}
                className="text-[10px] text-kumo-subtle font-mono whitespace-nowrap hover:text-kumo-default transition-colors"
                title="Change model"
              >
                {agent.model}
                {agent.variant && <span className="text-kumo-subtle/70"> ({agent.variant})</span>}
                {agent.lastActivityAtMs ? ` · ${formatRelativeTime(agent.lastActivityAtMs)}` : ''}
              </button>
            ) : (
              <span className="text-[10px] text-kumo-subtle font-mono whitespace-nowrap">
                {agent.model}
                {agent.variant && <span className="text-kumo-subtle/70"> ({agent.variant})</span>}
                {agent.lastActivityAtMs ? ` · ${formatRelativeTime(agent.lastActivityAtMs)}` : ''}
              </span>
            )}
            <ContextUsageIndicator used={agent.contextTokens} limit={agent.contextLimit} />
            <StatusBadge status={agent.status} />
            {onRemove && (
              <button
                onClick={onRemove}
                className="w-6 h-6 flex items-center justify-center rounded-md text-kumo-subtle hover:text-kumo-danger hover:bg-kumo-danger/10 transition-colors"
                title="Remove agent"
              >
                <Trash size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex overflow-x-auto border-b border-kumo-line shrink-0">
          {tabs.map((tab) => (
            <Tab
              key={tab.key}
              label={tab.label}
              count={tab.count}
              active={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key)}
            />
          ))}
        </div>

        {/* Tab Content — relative wrapper so the jump-to-latest button
            can be absolutely positioned over the scroll area without being
            inside it (avoids layout shifts that fight with scroll position) */}
        <div className="flex-1 relative overflow-hidden">
          <div
            ref={transcriptScrollRef}
            className="absolute inset-0 overflow-y-auto px-4 py-3 flex flex-col gap-2"
          >
            {activeTab === 'transcript' && (
              <div ref={transcriptContentRef} className="flex flex-col gap-2">
                {messages.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center gap-2 text-kumo-subtle text-sm">
                    {sessionNotice && (
                      <div className="rounded-full border border-kumo-brand/25 bg-kumo-brand/[0.08] px-3 py-1 text-[11px] font-medium text-kumo-brand">
                        {sessionNotice}
                      </div>
                    )}
                    <div>Waiting for messages...</div>
                  </div>
                ) : (
                  <>
                    {sessionNotice && (
                      <div className="self-center rounded-full border border-kumo-brand/25 bg-kumo-brand/[0.08] px-3 py-1 text-[11px] font-medium text-kumo-brand">
                        {sessionNotice}
                      </div>
                    )}
                    {hiddenCount > 0 && (
                      <button
                        onClick={handleLoadMore}
                        className="self-center px-3 py-1.5 text-[11px] font-medium text-kumo-link hover:text-kumo-strong bg-kumo-fill hover:bg-kumo-fill-hover border border-kumo-line rounded-full transition-colors cursor-pointer"
                      >
                        Load {Math.min(LOAD_MORE_INCREMENT, hiddenCount)} earlier message{hiddenCount === 1 ? '' : 's'}
                      </button>
                    )}
                    {visibleMessages.map((message) => (
                      <MessageBubble
                        key={message.id}
                        message={message}
                        verbosity={outputVerbosity}
                        registerRef={registerMessageRef}
                      />
                    ))}
                  </>
                )}

                {/* Loading indicator when agent is running */}
                {agent.status === 'running' && (
                  <div className="flex items-center gap-2 px-3 py-2">
                    <span className="text-[11px] text-kumo-subtle">Agent is thinking</span>
                    <span className="flex gap-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-kumo-subtle animate-bounce [animation-delay:0ms]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-kumo-subtle animate-bounce [animation-delay:150ms]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-kumo-subtle animate-bounce [animation-delay:300ms]" />
                    </span>
                  </div>
                )}

                {/* Permission request inline card */}
                {permission && (
                  <div className="bg-kumo-brand/[0.06] border border-kumo-brand/20 rounded-lg p-3 flex flex-col gap-2">
                    <div className="text-xs font-semibold text-kumo-brand flex items-center gap-1.5">
                      &#128274; Permission Request
                    </div>
                    <div className="text-xs text-kumo-default">{permission.title}</div>
                    {permission.pattern && (
                      <div className="font-mono text-[11px] px-2 py-1 bg-kumo-overlay rounded text-kumo-subtle">
                        {Array.isArray(permission.pattern) ? permission.pattern.join(', ') : permission.pattern}
                      </div>
                    )}
                    <div className="flex gap-1.5">
                      {onApprove && (
                        <button
                          onClick={onApprove}
                          className="flex-1 flex items-center justify-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-md bg-kumo-success/12 border border-kumo-success/25 text-kumo-success hover:bg-kumo-success/20 transition-colors"
                        >
                          <Check size={12} weight="bold" /> Approve Once
                        </button>
                      )}
                      {onApproveAlways && (
                        <button
                          onClick={onApproveAlways}
                          className="flex-1 flex items-center justify-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-md bg-kumo-success/12 border border-kumo-success/25 text-kumo-success hover:bg-kumo-success/20 transition-colors"
                        >
                          <CheckCircle size={12} weight="fill" /> Approve Always
                        </button>
                      )}
                      {onDeny && (
                        <button
                          onClick={onDeny}
                          className="flex-1 flex items-center justify-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-md bg-kumo-danger/10 border border-kumo-danger/20 text-kumo-danger hover:bg-kumo-danger/20 transition-colors"
                        >
                          <XCircle size={12} /> Deny
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Question card — show only when we actually have structured question
                    content. If the server delivered a malformed event with an empty
                    `questions` array, fall through to the "Waiting for your response"
                    placeholder so the user isn't stuck staring at a bare header. */}
                {!permission && question && question.questions.length > 0 && (
                  <QuestionCard
                    question={question}
                    onReply={onReplyQuestion}
                    onReject={onRejectQuestion}
                  />
                )}

                {/* Waiting for input (no structured question, or question payload was empty) */}
                {!permission
                  && (!question || question.questions.length === 0)
                  && agent.status === 'needs_input' && (
                  <div className="bg-status-input-bg/30 border border-status-input/20 rounded-lg p-3 flex flex-col gap-2">
                    <div className="text-xs font-semibold text-status-input flex items-center gap-1.5">
                      <ChatCircleDots size={14} weight="fill" /> Waiting for your response
                    </div>
                    <div className="text-xs text-kumo-default">
                      This agent has asked a question and is waiting for your reply. Use the input below to respond.
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'todos' && <TodoList todos={latestTodos} />}

            {activeTab === 'files' && (
              <FilesChanged
                files={files}
                onFileClick={onOpenWorkspace ? (path) => onOpenWorkspace(path) : undefined}
              />
            )}
            {activeTab === 'tools' && <ToolsUsage tools={tools} verbosity={outputVerbosity} />}
            {activeTab === 'events' && <EventLog events={events} verbosity={outputVerbosity} />}
            {activeTab === 'config' && (
              <AgentConfigPanel
                agent={agent}
                outputVerbosity={outputVerbosity}
                onOutputVerbosityChange={handleOutputVerbosityChange}
                onChangeModel={onChangeModel}
              />
            )}
          </div>

          {/* Jump to latest — absolutely positioned over the scroll area
              but outside its DOM flow, so toggling doesn't affect scrollHeight */}
          {showJumpToLatest && activeTab === 'transcript' && (
            <div className="absolute bottom-3 left-0 right-0 z-10 flex justify-center pointer-events-none">
              <button
                type="button"
                onClick={reengageFollow}
                className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-kumo-interact/30 bg-kumo-interact/12 px-3 py-1.5 text-[11px] font-medium text-kumo-link shadow-lg backdrop-blur hover:bg-kumo-interact/18 transition-colors"
              >
                <CaretDown size={12} />
                Jump to latest
              </button>
            </div>
          )}
        </div>

        {/* Vertical resize handle */}
        {/* Resize handle + bottom pane (chat input + action rail) only show
            on the Transcript tab. The other tabs (Files Changed, Tools,
            Events) are pure read-only views — keeping the composer there
            offered nothing and stole space from the content above. */}
        {activeTab === 'transcript' && (
        <>
        <div
          onMouseDown={handleVerticalResizeStart}
          className="h-1.5 shrink-0 cursor-row-resize group flex items-center justify-center border-t border-kumo-line"
        >
          <div className="h-px w-8 rounded-full bg-kumo-subtle/30 group-hover:bg-kumo-brand/50 transition-colors" />
        </div>

        {/* Bottom pane — action rail + input, resizable height */}
        <div style={{ height: inputHeight }} className="shrink-0 flex flex-col min-h-0">
        {/* Action Rail */}
        <div className="flex flex-wrap gap-1 items-center px-3 py-1.5 border-t border-kumo-line shrink-0">
          {onApprove && (
            <ActionButton icon={<Check size={12} weight="bold" />} label="Approve Once" variant="approve" onClick={onApprove} />
          )}
          {onApproveAlways && (
            <ActionButton icon={<CheckCircle size={12} weight="fill" />} label="Approve Always" variant="approve" onClick={onApproveAlways} />
          )}
          {onDeny && (
            <ActionButton icon={<XCircle size={12} />} label="Deny" variant="deny" onClick={onDeny} />
          )}
          {/* Custom quick action buttons — positional slots */}
          {quickActions.map((qa, i) => {
            if (qa && isQuickActionValid(qa)) {
              return (
                <QuickActionButton
                  key={qa.id}
                  action={qa}
                  onClick={onQuickAction ? () => onQuickAction(qa) : undefined}
                />
              )
            }
            return (
              <button
                key={`placeholder-${i}`}
                type="button"
                onClick={onOpenQuickActionSettings}
                className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-md border border-dashed whitespace-nowrap border-kumo-line text-kumo-subtle/50 hover:border-kumo-subtle hover:text-kumo-subtle transition-colors"
                title="Configure in Settings → Quick Actions"
              >
                <Plus size={10} />
                Custom
              </button>
            )
          })}
        </div>

        {/* Status banner — shows compaction in progress or a session-level error. */}
        <StatusBanner
          agent={agent}
          onCompact={onCompact}
          onStartFreshSession={onStartFreshSession}
          onDismissError={onDismissError}
        />

        {/* Input row: text input left, action buttons + send right */}
        <div
          className={`flex gap-2 px-3 py-2 border-t flex-1 min-h-0 transition-colors ${
            isDragOver ? 'border-kumo-brand bg-kumo-brand/[0.04]' : 'border-kumo-line'
          }`}
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Input container */}
          <div className={`relative flex flex-col flex-1 min-h-0 rounded-lg border bg-kumo-control transition-colors ${
            isDragOver ? 'border-kumo-brand' : 'border-kumo-line focus-within:border-kumo-ring'
          }`}>
            {/* Autocomplete popups — portal'd above the textarea so they
                escape the input container's overflow/border, with viewport
                flipping handled by PortaledMenu. */}
            <PortaledMenu
              open={showCommandAutocomplete}
              triggerRef={textareaRef}
              placement="top-left"
              matchTriggerWidth
              gap={8}
              onDismiss={() => {}}
              className="rounded-lg border border-kumo-line bg-kumo-overlay p-1 shadow-xl max-h-60 overflow-y-auto"
            >
              {matchingCommands.map((item, index) => (
                <button
                  key={item.command}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault()
                    setInputText(`${item.command} `)
                  }}
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
            </PortaledMenu>
            <PortaledMenu
              open={showAgentPicker}
              triggerRef={textareaRef}
              placement="top-left"
              matchTriggerWidth
              gap={8}
              onDismiss={() => setAgentPickerDismissed(true)}
              className="rounded-lg border border-kumo-line bg-kumo-overlay p-1 shadow-xl max-h-60 overflow-y-auto"
            >
              <div className="px-2.5 py-1.5 text-[10px] font-medium text-kumo-subtle uppercase tracking-wide">
                Agents
              </div>
              {matchingAgents.map((cfg, index) => (
                <button
                  key={cfg.name}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault()
                    insertAgentMention(cfg.name)
                  }}
                  className={`flex w-full items-start gap-3 rounded-md px-2.5 py-2 text-left transition-colors ${
                    index === agentPickerIndex ? 'bg-kumo-fill' : 'hover:bg-kumo-fill'
                  }`}
                >
                  <span className="font-mono text-[11px] text-kumo-brand">@{cfg.name}</span>
                  {cfg.description && (
                    <span className="text-[11px] text-kumo-subtle truncate">{cfg.description}</span>
                  )}
                </button>
              ))}
              <div className="px-2.5 py-1 text-[10px] text-kumo-subtle border-t border-kumo-line mt-1 pt-1">
                Tab/Enter to select · Arrow keys to navigate · Esc to dismiss
              </div>
            </PortaledMenu>

            {/* Attachment thumbnails inside the container */}
            {attachments.length > 0 && (
              <div className="flex gap-2 px-3 pt-2 overflow-x-auto">
                {attachments.map((att) => (
                  <div key={att.id} className="relative group shrink-0">
                    <img
                      src={att.dataUrl}
                      alt={att.filename ?? 'attachment'}
                      className="h-14 w-14 rounded-md border border-kumo-line object-cover"
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

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={inputText}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onKeyUp={(e) => setCursorPos(e.currentTarget.selectionStart)}
              onClick={(e) => setCursorPos(e.currentTarget.selectionStart)}
              onPaste={handlePaste}
              placeholder={inputPlaceholder}
              className="w-full flex-1 min-h-0 px-3 py-2.5 bg-transparent text-kumo-default text-sm outline-none placeholder:text-kumo-subtle resize-none"
            />

            {/* Bottom row: hints + context usage */}
            <div className="flex items-center px-2 pb-1.5 shrink-0">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1 text-[10px] text-kumo-subtle hover:text-kumo-default transition-colors px-1 py-0.5 rounded"
                title="Attach image"
              >
                <Paperclip size={12} />
                <span>Attach</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                multiple
                className="hidden"
                onChange={handleFileInputChange}
              />
              <span className="text-[10px] text-kumo-subtle/60 ml-2">
                ↵ send · ⇧↵ newline
              </span>
              <span className="ml-auto">
                <ContextUsageIndicator used={agent.contextTokens} limit={agent.contextLimit} />
              </span>
            </div>
          </div>

          {/* Right column: scrollable secondary actions · pinned primary button.
              The inner scroll region gets flex-1 + min-h-0 so it absorbs the
              column's free space and clips — otherwise the secondary buttons'
              natural height pushes the primary button (Send/Stop) off-screen
              when the bottom pane is resized small. */}
          <div className="flex flex-col gap-1 shrink-0 w-[88px] min-h-0 h-full">
            <div className="flex flex-col gap-1 flex-1 min-h-0 overflow-y-auto">
              {onToggleLabel && onClearLabels && (
                <LabelDropdown
                  current={agent.labelIds}
                  onToggle={onToggleLabel}
                  onClear={onClearLabels}
                  allLabels={allLabels}
                  onCreateLabel={onCreateLabel}
                  onDeleteLabel={onDeleteLabel}
                  variant="action"
                  className="w-full"
                />
              )}
              <ActionDropdownButton
                icon={<GitPullRequest size={12} />}
                label="PR"
                className="w-full"
                items={[
                  {
                    icon: <ArrowLineUpRight size={12} />,
                    label: 'View PR',
                    onClick: agent.prUrl ? () => window.api?.openExternal(agent.prUrl!) : undefined
                  },
                  {
                    icon: <Link size={12} />,
                    label: agent.prUrl ? 'Edit PR Link' : 'Add PR Link',
                    onClick: onSetPrUrl ? () => setShowPrLinkModal(true) : undefined
                  },
                  {
                    icon: <Trash size={12} />,
                    label: 'Remove PR Link',
                    onClick: agent.prUrl && onSetPrUrl ? () => onSetPrUrl(null) : undefined
                  },
                  {
                    icon: <GitPullRequest size={12} />,
                    label: 'Create PR',
                    onClick: onCreatePr
                  }
                ]}
              />
              {onOpenWorkspace && (
                <ActionButton
                  icon={<Code size={12} />}
                  label="Review"
                  onClick={() => onOpenWorkspace()}
                  className="w-full"
                />
              )}
              <ActionDropdownButton
                icon={<ArrowSquareOut size={12} />}
                label="Open In"
                className="w-full"
                items={[
                  { icon: <Terminal size={12} />, label: 'Terminal', onClick: onOpenTerminal },
                  { icon: <ArrowSquareOut size={12} />, label: editorLabel, onClick: onOpenInEditor }
                ]}
              />
              {onChangeModel && (
                <ActionButton
                  icon={<SlidersHorizontal size={12} />}
                  label="Config"
                  onClick={() => setActiveTab('config')}
                  className="w-full"
                />
              )}
              {onCompact && (
                <ActionButton
                  icon={agent.compacting ? <CircleNotch size={12} className="animate-spin" /> : <ArrowsInLineHorizontal size={12} />}
                  label={agent.compacting ? 'Compacting…' : 'Compact'}
                  onClick={onCompact}
                  disabled={agent.compacting}
                  className="w-full"
                />
              )}
            </div>
            {/* Primary action button sits directly below the scroll region so
                it's always visible, no matter how tall the content is above. */}
            {(() => {
              const isRunningLike = agent.status === 'running' || agent.status === 'needs_approval' || agent.status === 'needs_input' || agent.status === 'stopping'

              if (onAbort && isRunningLike) {
                return (
                  <button
                    onClick={onAbort}
                    disabled={agent.status === 'stopping'}
                    className="shrink-0 flex items-center justify-center gap-1.5 w-full h-7 rounded-lg bg-kumo-danger/90 text-white text-xs font-medium transition-colors hover:bg-kumo-danger disabled:opacity-50"
                    title={agent.status === 'stopping' ? 'Stopping…' : 'Stop agent'}
                  >
                    <Stop size={12} weight="fill" />
                    {agent.status === 'stopping' ? 'Stopping…' : 'Stop'}
                  </button>
                )
              }

              return (
                <button
                  onClick={handleSend}
                  disabled={!inputText.trim() && attachments.length === 0}
                  className={`shrink-0 flex items-center justify-center gap-1.5 w-full h-7 rounded-lg text-white text-xs font-medium transition-all disabled:opacity-30 ${
                    canReplyViaChat ? 'bg-status-input hover:bg-status-input/80' : 'bg-kumo-brand hover:bg-kumo-brand-hover'
                  }`}
                  title={canReplyViaChat ? 'Reply' : 'Send message'}
                >
                  <ArrowUp size={12} weight="bold" />
                  {canReplyViaChat ? 'Reply' : 'Send'}
                </button>
              )
            })()}
          </div>
        </div>
        </div>{/* end bottom pane */}
        </>
        )}
      </div>

      {showPrLinkModal && onSetPrUrl && (
        <TextInputModal
          title={agent.prUrl ? 'Edit PR Link' : 'Add PR Link'}
          initialValue={agent.prUrl ?? ''}
          submitLabel="Save"
          placeholder="https://github.com/org/repo/pull/123"
          allowEmpty
          onSubmit={(url) => {
            onSetPrUrl(url || null)
            setShowPrLinkModal(false)
          }}
          onClose={() => setShowPrLinkModal(false)}
        />
      )}

    </div>
  )
})

function TodoList({ todos }: { todos: AgentTodo[] }) {
  const completedCount = todos.filter((todo) => todo.status === 'completed').length
  const inProgressCount = todos.filter((todo) => todo.status === 'in_progress').length
  const pendingCount = todos.filter((todo) => todo.status === 'pending').length
  const cancelledCount = todos.filter((todo) => todo.status === 'cancelled').length
  const progressPercent = todos.length > 0 ? Math.round((completedCount / todos.length) * 100) : 0

  if (todos.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-kumo-subtle py-12">
        <CheckCircle size={28} weight="duotone" />
        <span className="text-sm">No TODO list yet</span>
        <span className="max-w-sm text-center text-xs">
          The latest todowrite call will appear here when the agent creates or updates its plan.
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 py-2">
      <div className="rounded-lg border border-kumo-line bg-kumo-control p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-kumo-strong">Agent TODO</div>
            <div className="mt-0.5 text-[11px] text-kumo-subtle">
              {completedCount} of {todos.length} complete
            </div>
          </div>
          <div className="text-lg font-semibold text-kumo-strong">{progressPercent}%</div>
        </div>
        <div className="mt-3 h-1.5 rounded-full bg-kumo-overlay overflow-hidden">
          <div
            className="h-full rounded-full bg-kumo-success transition-[width]"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <TodoSummaryPill label="In Progress" count={inProgressCount} status="in_progress" />
          <TodoSummaryPill label="Pending" count={pendingCount} status="pending" />
          <TodoSummaryPill label="Completed" count={completedCount} status="completed" />
          <TodoSummaryPill label="Cancelled" count={cancelledCount} status="cancelled" />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {todos.map((todo, index) => (
          <div
            key={`${todo.content}-${index}`}
            className="rounded-lg border border-kumo-line bg-kumo-control px-3 py-2.5"
          >
            <div className="flex items-start gap-2.5">
              <TodoStatusIcon status={todo.status} />
              <div className="min-w-0 flex-1">
                <div className={`text-sm leading-snug ${todo.status === 'cancelled' ? 'line-through text-kumo-subtle' : 'text-kumo-default'}`}>
                  {todo.content}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${todoStatusStyles[todo.status]}`}>
                    {todoStatusLabels[todo.status]}
                  </span>
                  {todo.priority && (
                    <span className="inline-flex items-center rounded-full border border-kumo-line bg-kumo-fill px-1.5 py-0.5 text-[10px] font-medium capitalize text-kumo-subtle">
                      {todo.priority}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function TodoSummaryPill({ label, count, status }: { label: string; count: number; status: TodoStatus }) {
  if (count === 0) return null

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium ${todoStatusStyles[status]}`}>
      {label}
      <span className="text-kumo-default">{count}</span>
    </span>
  )
}

function TodoStatusIcon({ status }: { status: TodoStatus }) {
  if (status === 'completed') {
    return <CheckCircle size={16} weight="fill" className="mt-0.5 shrink-0 text-kumo-success" />
  }
  if (status === 'in_progress') {
    return <CircleNotch size={16} className="mt-0.5 shrink-0 animate-spin text-kumo-link" />
  }
  if (status === 'cancelled') {
    return <XCircle size={16} className="mt-0.5 shrink-0 text-kumo-subtle" />
  }
  return <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full border border-kumo-subtle/50" />
}

function QuestionCard({
  question,
  onReply,
  onReject
}: {
  question: LiveQuestion
  onReply?: (answers: string[][]) => void
  onReject?: () => void
}) {
  const totalQuestions = question.questions.length
  const isSingleQuestion = totalQuestions === 1

  const [answers, setAnswers] = useState<string[][]>(() =>
    question.questions.map(() => [])
  )
  const [customTexts, setCustomTexts] = useState<string[]>(() =>
    question.questions.map(() => '')
  )

  useEffect(() => {
    setAnswers(question.questions.map(() => []))
    setCustomTexts(question.questions.map(() => ''))
  }, [question.id, question.questions])

  const allAnswered = useMemo(() =>
    question.questions.every((_, qi) => answers[qi].length > 0 || customTexts[qi]?.trim()),
    [question.questions, answers, customTexts]
  )

  function toggleOption(qi: number, label: string, multiple: boolean) {
    setAnswers(prev => {
      const next = [...prev]
      const current = next[qi]
      if (multiple) {
        next[qi] = current.includes(label)
          ? current.filter(l => l !== label)
          : [...current, label]
      } else {
        next[qi] = current[0] === label ? [] : [label]
      }
      return next
    })
    // For single-select, clear custom text so stale input isn't silently appended
    if (!multiple) {
      setCustomTexts(prev => {
        const next = [...prev]
        next[qi] = ''
        return next
      })
    }
  }

  function setCustomAnswer(qi: number, text: string) {
    setCustomTexts(prev => {
      const next = [...prev]
      next[qi] = text
      return next
    })
  }

  function buildFinalAnswers(): string[][] {
    return question.questions.map((_q, qi) => {
      const custom = customTexts[qi]?.trim()
      if (custom) {
        return [...answers[qi], custom]
      }
      return answers[qi]
    })
  }

  function handleSubmit() {
    const final = buildFinalAnswers()
    const ready = final.every(a => a.length > 0)
    if (ready) {
      onReply?.(final)
    }
  }

  return (
    <div className="bg-status-input-bg/30 border border-status-input/20 rounded-lg p-3 flex flex-col gap-2">
      <div className="text-xs font-semibold text-status-input flex items-center gap-1.5">
        <ChatCircleDots size={14} weight="fill" />
        {isSingleQuestion ? 'Question' : `Questions (${totalQuestions})`}
      </div>

      {question.questions.map((q, qi) => {
        const isMultiple = q.multiple ?? false
        const selected = answers[qi]

        return (
          <div key={qi} className="flex flex-col gap-1.5">
            {q.header && (
              <div className="text-xs font-medium text-kumo-default">
                {!isSingleQuestion && <span className="text-kumo-subtle mr-1">{qi + 1}.</span>}
                {q.header}
              </div>
            )}
            <div className="text-xs text-kumo-subtle">{q.question}</div>
            {q.options.length > 0 && (
              <div className="flex flex-col gap-1 mt-1">
                {q.options.map((opt, oi) => {
                  const isSelected = selected.includes(opt.label)

                  return (
                    <button
                      key={oi}
                      type="button"
                      onClick={() => toggleOption(qi, opt.label, isMultiple)}
                      className={`flex flex-col items-start px-2.5 py-1.5 text-left text-[11px] rounded-md border transition-colors ${
                        isSelected
                          ? 'bg-status-input-bg/40 border-status-input/50 ring-1 ring-status-input/30'
                          : 'bg-kumo-overlay border-kumo-interact/20 hover:border-status-input/40 hover:bg-status-input-bg/20'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 w-full">
                        <span className={`flex items-center justify-center w-3.5 h-3.5 rounded-${isMultiple ? 'sm' : 'full'} border ${
                          isSelected
                            ? 'border-status-input bg-status-input text-white'
                            : 'border-kumo-interact/40'
                        }`}>
                          {isSelected && <Check size={8} weight="bold" />}
                        </span>
                        <span className="font-medium text-kumo-default">{opt.label}</span>
                      </div>
                      {opt.description && (
                        <span className="text-kumo-subtle ml-5">{opt.description}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
            <input
              type="text"
              value={customTexts[qi]}
              onChange={(e) => setCustomAnswer(qi, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSubmit()
                }
              }}
              placeholder="Type your own answer..."
              className="mt-1 px-2.5 py-1.5 text-[11px] rounded-md bg-kumo-overlay border border-kumo-interact/20 text-kumo-default outline-none focus:border-status-input/50 placeholder:text-kumo-subtle"
            />
          </div>
        )
      })}

      <div className="flex items-center gap-2 mt-1">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!allAnswered}
          className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-md bg-status-input/15 border border-status-input/30 text-status-input hover:bg-status-input/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <PaperPlaneTilt size={12} weight="fill" /> Submit
        </button>
        {onReject && (
          <button
            type="button"
            onClick={onReject}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-md bg-kumo-danger/10 border border-kumo-danger/20 text-kumo-danger hover:bg-kumo-danger/20 transition-colors"
          >
            <XCircle size={12} /> Dismiss
          </button>
        )}
      </div>
    </div>
  )
}

/** Copies an absolute path to the clipboard, for pasting into a shell or Finder. */
function CopyPathButton({ path }: { path: string }) {
  // The counter restarts the timer on a repeat click; keying the effect on
  // `result` alone would let a second copy inherit the first one's deadline and
  // flash the checkmark for a few milliseconds.
  const [{ result, attempt }, setState] = useState<{ result: 'idle' | 'copied' | 'failed'; attempt: number }>({ result: 'idle', attempt: 0 })
  const setResult = (next: 'idle' | 'copied' | 'failed'): void =>
    setState((prev) => ({ result: next, attempt: prev.attempt + 1 }))

  useEffect(() => {
    if (result === 'idle') return
    const timer = setTimeout(() => setResult('idle'), 1500)
    return () => clearTimeout(timer)
  }, [result, attempt])

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(path)
      setResult('copied')
    } catch (error) {
      // A denied clipboard permission looks identical to success unless the icon
      // changes, and the user would paste stale content without knowing.
      console.error('[DetailDrawer] Failed to copy path:', error)
      setResult('failed')
    }
  }, [path])

  const label = result === 'copied' ? 'Path copied' : result === 'failed' ? 'Copy failed' : 'Copy workspace path'

  return (
    <button
      onClick={handleCopy}
      aria-label={label}
      className={`shrink-0 w-4 h-4 flex items-center justify-center rounded transition-colors ${
        result === 'failed'
          ? 'text-kumo-danger'
          : 'text-kumo-subtle hover:text-kumo-default hover:bg-kumo-fill'
      }`}
      title={result === 'idle' ? `Copy path\n${path}` : label}
    >
      {result === 'copied' ? <Check size={10} /> : result === 'failed' ? <XCircle size={10} /> : <Copy size={10} />}
    </button>
  )
}

function Tab({
  label,
  count,
  active = false,
  onClick
}: {
  label: string
  count?: number
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 px-4 py-2 text-xs font-medium cursor-pointer border-b-2 transition-colors flex items-center gap-1.5 ${
        active
          ? 'text-kumo-strong border-kumo-brand'
          : 'text-kumo-subtle border-transparent hover:text-kumo-default'
      }`}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span
          className={`inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[10px] font-medium ${
            active
              ? 'bg-kumo-brand/15 text-kumo-brand'
              : 'bg-kumo-fill text-kumo-subtle'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  )
}

const outputVerbosityDescriptions: Record<OutputVerbosity, string> = {
  none: 'Keep tool and event details collapsed.',
  some: 'Expand parent tools and events, but collapse subagent transcripts.',
  all: 'Expand parent tools, events, and subagent transcripts.'
}

function AgentConfigPanel({
  agent,
  outputVerbosity,
  onOutputVerbosityChange,
  onChangeModel
}: {
  agent: AgentRuntime
  outputVerbosity: OutputVerbosity
  onOutputVerbosityChange: (value: OutputVerbosity) => void
  onChangeModel?: (modelPath: string, variant?: string) => Promise<boolean>
}) {
  const { options, loading, providerData, configModel } = useModelOptions(agent.id)
  const [selectedModel, setSelectedModel] = useState(agent.configuredModelPath ?? agent.model)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const savingRef = useRef(false)

  useEffect(() => {
    setSelectedModel(agent.configuredModelPath ?? configModel ?? agent.model)
    setSaveError(null)
  }, [agent.id, agent.configuredModelPath, agent.model, configModel])

  const modelOptions = useMemo(() => {
    const concreteOptions = options.filter((option) => option.value !== 'auto')
    if (concreteOptions.some((option) => option.value === selectedModel)) return concreteOptions
    return [
      { value: selectedModel, label: `Current (${agent.model})` },
      ...concreteOptions
    ]
  }, [agent.model, options, selectedModel])

  const effortOptions = useMemo(
    () => getVariantOptionsForModel(selectedModel, providerData, configModel),
    [selectedModel, providerData, configModel]
  )
  const selectedEffort = effortOptions.some((option) => option.value === agent.variant)
    ? agent.variant ?? 'auto'
    : 'auto'

  const updateModel = async (modelPath: string, variant?: string): Promise<void> => {
    if (!onChangeModel || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setSaveError(null)
    try {
      const updated = await onChangeModel(modelPath, variant)
      if (updated) {
        setSelectedModel(modelPath)
        return
      }
      setSaveError('Could not update this agent. Its current configuration is unchanged.')
    } catch {
      setSaveError('Could not update this agent. Its current configuration is unchanged.')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const selectButtonClasses =
    'flex w-full items-center justify-between gap-3 rounded-md border border-kumo-line bg-kumo-control px-3 py-2 text-sm text-kumo-default outline-none transition-colors hover:bg-kumo-fill focus:border-kumo-ring'
  const selectMenuClasses =
    'max-h-[min(24rem,calc(100vh-1rem))] overflow-y-auto rounded-md border border-kumo-line bg-kumo-overlay shadow-xl'

  return (
    <div className="flex flex-col gap-6 py-2">
      <section className="flex flex-col gap-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-kumo-subtle">Output Detail</h3>
          <p className="mt-1 text-[11px] text-kumo-subtle">Applies only to this agent.</p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {OUTPUT_VERBOSITY_OPTIONS.map((option) => {
            const selected = outputVerbosity === option.value
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onOutputVerbosityChange(option.value)}
                className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  selected
                    ? 'border-kumo-brand/40 bg-kumo-brand/10 text-kumo-strong'
                    : 'border-kumo-line bg-kumo-control text-kumo-default hover:bg-kumo-fill'
                }`}
              >
                <span className="block text-xs font-semibold">{option.label}</span>
                <span className="mt-1 block text-[10px] leading-snug text-kumo-subtle">
                  {outputVerbosityDescriptions[option.value]}
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-kumo-subtle">Model</h3>
          <p className="mt-1 text-[11px] text-kumo-subtle">Changes the model for this agent's next prompt.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-medium text-kumo-default">Model</label>
          <SelectField
            value={selectedModel}
            options={modelOptions}
            disabled={saving || !onChangeModel}
            onChange={(value) => void updateModel(value)}
            searchable
            searchPlaceholder="Search models..."
            buttonClassName={selectButtonClasses}
            menuClassName={selectMenuClasses}
          />
          {loading && <span className="text-[10px] text-kumo-subtle">Loading provider models...</span>}
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-medium text-kumo-default">Effort</label>
          <SelectField
            value={selectedEffort}
            options={effortOptions}
            disabled={saving || !onChangeModel}
            onChange={(value) => void updateModel(selectedModel, value === 'auto' ? undefined : value)}
            buttonClassName={selectButtonClasses}
            menuClassName={selectMenuClasses}
          />
          <span className="text-[10px] text-kumo-subtle">
            {effortOptions.length === 1
              ? 'This model does not expose explicit effort levels.'
              : "Provider Default removes this agent's effort override."}
          </span>
        </div>
        {saving && <span className="text-[11px] text-kumo-link">Saving configuration...</span>}
        {saveError && <span className="text-[11px] text-kumo-danger">{saveError}</span>}
      </section>
    </div>
  )
}

type MessageRefCallback = (id: string, node: HTMLElement | null) => void

const MessageBubble = memo(function MessageBubble({
  message,
  verbosity = 'none',
  registerRef
}: {
  message: Message
  verbosity?: OutputVerbosity
  registerRef?: MessageRefCallback
}) {
  const rootRef = useCallback((node: HTMLElement | null) => {
    registerRef?.(message.id, node)
  }, [message.id, registerRef])

  if (message.role === 'tool-group') {
    return <ToolGroupBubble message={message} verbosity={verbosity} rootRef={rootRef} />
  }

  if (message.role === 'compaction') {
    return (
      <div
        ref={rootRef}
        className="self-center my-2 px-3 py-1.5 text-[11px] text-kumo-warning/90 border border-kumo-warning/30 bg-kumo-warning/10 rounded-full flex items-center gap-1.5"
      >
        {message.compactionActive
          ? <CircleNotch size={11} weight="bold" className="animate-spin" />
          : <ArrowsInLineHorizontal size={11} weight="bold" />
        }
        <span>{message.compactionActive ? 'Compacting session…' : message.content}</span>
      </div>
    )
  }

  if (message.role === 'tool') {
    const toolName = message.toolName ?? extractToolName(message.content)
    const toolOutput = message.content ? extractToolOutput(message.content) : ''
    return (
      <div ref={rootRef} className="font-mono text-[11px] px-2.5 py-1.5 bg-kumo-overlay border-l-2 border-kumo-fill-hover rounded-r-md text-kumo-subtle">
        <div className="flex items-center gap-1.5 mb-0.5">
          <Wrench size={11} className="shrink-0" />
          <span className="font-semibold text-kumo-default">{toolName}</span>
          <CircleNotch size={11} className={toolIconStyle(message.toolState)} />
        </div>
        {toolOutput && (
          <div className="whitespace-pre-wrap break-all mt-1">{toolOutput}</div>
        )}
      </div>
    )
  }

  const isUser = message.role === 'user'
  const [copied, setCopied] = useState(false)

  // Clear the "copied" indicator after a short delay, cancelling the
  // timer if the message unmounts or the user copies again first.
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])

  const handleCopy = useCallback(async () => {
    if (!message.content) return
    try {
      await navigator.clipboard.writeText(message.content)
      setCopied(true)
    } catch {
      // clipboard write can fail silently
    }
  }, [message.content])

  const copyLabel = copied ? 'Copied' : 'Copy message'

  return (
    <div
      ref={rootRef}
      className={`group relative px-3 py-2.5 rounded-lg text-[13px] leading-relaxed ${
        isUser
          ? 'bg-kumo-interact/10 border border-kumo-interact/15 text-kumo-default self-end max-w-[85%]'
          : 'bg-kumo-control border border-kumo-line text-kumo-default max-w-[95%]'
      }`}
    >
      {message.content && (
        <button
          type="button"
          onClick={handleCopy}
          title={copyLabel}
          aria-label={copyLabel}
          className="absolute top-1.5 right-1.5 p-1 rounded text-kumo-subtle/60 hover:text-kumo-default hover:bg-kumo-fill/60 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity cursor-pointer"
        >
          {copied
            ? <Check size={12} weight="bold" />
            : <Copy size={12} weight="regular" />}
        </button>
      )}
      <div className="text-[10px] font-semibold uppercase tracking-wide text-kumo-subtle mb-1">
        {isUser ? 'You' : 'Agent'}
      </div>
      {message.images && message.images.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {message.images.map((img, index) => (
            <div key={index} className="relative group">
              <img
                src={img.url}
                alt={img.filename ?? 'attached image'}
                className="max-h-48 max-w-full rounded-md border border-kumo-line object-contain cursor-pointer"
                onClick={() => window.open(img.url, '_blank')}
              />
              {img.filename && (
                <div className="text-[9px] text-kumo-subtle mt-0.5 truncate max-w-[200px]">
                  {img.filename}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {message.content && (
        isUser
          ? <div className="whitespace-pre-wrap">{message.content}</div>
          : <Markdown>{message.content}</Markdown>
      )}
    </div>
  )
}, (prev, next) =>
  prev.message.id === next.message.id &&
  prev.message.content === next.message.content &&
  prev.message.role === next.message.role &&
  prev.message.toolCalls === next.message.toolCalls &&
  prev.verbosity === next.verbosity &&
  prev.registerRef === next.registerRef
)

const toolStateStyles: Record<string, string> = {
  failed: 'text-kumo-danger',
  completed: 'text-kumo-success',
  running: 'text-kumo-link'
}

function toolIconStyle(toolState: string | undefined): string {
  if (toolState === 'failed') return 'text-kumo-danger'
  if (toolState === 'completed') return 'text-kumo-success'
  return 'text-kumo-link animate-spin'
}

const todoStatusIcons: Record<string, string> = {
  completed: '[x]',
  in_progress: '[~]'
}

function summarizeToolInput(name: string, input: string | undefined): string | undefined {
  if (!input) return undefined
  try {
    const parsed = JSON.parse(input)
    switch (name.toLowerCase()) {
      case 'bash':
        return parsed.command ? `$ ${parsed.command}` : undefined

      case 'read': {
        if (!parsed.filePath) return undefined
        const range = parsed.offset
          ? `:${parsed.offset}${parsed.limit ? `-${parsed.offset + parsed.limit}` : ''}`
          : ''
        return parsed.filePath + range
      }

      case 'write':
      case 'edit':
        return parsed.filePath ?? undefined

      case 'grep': {
        if (!parsed.pattern) return undefined
        const scope = parsed.include ? ` (${parsed.include})` : parsed.path ? ` in ${parsed.path}` : ''
        return `/${parsed.pattern}/${scope}`
      }

      case 'glob':
        return parsed.pattern
          ? parsed.pattern + (parsed.path ? ` in ${parsed.path}` : '')
          : undefined

      case 'task':
        return parsed.description ?? undefined

      case 'todowrite':
        if (!Array.isArray(parsed.todos)) return undefined
        return parsed.todos
          .map((t: { content?: string; status?: string }) =>
            `${todoStatusIcons[t.status ?? ''] ?? '[ ]'} ${t.content ?? ''}`)
          .join('\n')

      case 'webfetch':
        return parsed.url ?? undefined

      default:
        return undefined
    }
  } catch {
    return undefined
  }
}

export const ToolGroupBubble = memo(function ToolGroupBubble({
  message,
  verbosity = 'none',
  rootRef
}: {
  message: Message
  verbosity?: OutputVerbosity
  rootRef?: (node: HTMLElement | null) => void
}) {
  const toolCalls = message.toolCalls ?? []

  // Auto-expand the bubble when any tool in the group is still running so
  // the user can see progress without having to click. Otherwise the bubble
  // looks frozen ("tool completed" only appears at the very end) and the user
  // has no feedback until the tool finishes — which for CI-watching tasks
  // can be many minutes.
  const hasRunningTool = toolCalls.some((tool) => tool.state === 'running')
  const [expanded, setExpanded] = useState(verbosity !== 'none' || hasRunningTool)
  const previousVerbosityRef = useRef(verbosity)

  useEffect(() => {
    if (previousVerbosityRef.current === verbosity) return
    setExpanded(verbosity !== 'none' || hasRunningTool)
    previousVerbosityRef.current = verbosity
  }, [verbosity, hasRunningTool])

  // Once a tool starts running inside this group, force the bubble open.
  // We don't collapse it again when the tool finishes — the user may want to
  // scroll back through the progress.
  useEffect(() => {
    if (hasRunningTool) setExpanded(true)
  }, [hasRunningTool])

  return (
    <div ref={rootRef} className="max-w-[95%] self-start">
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className="inline-flex items-center gap-2 rounded-lg border border-kumo-line bg-kumo-overlay px-3 py-2 text-left hover:bg-kumo-fill transition-colors"
      >
        <span className="text-kumo-subtle">
          {expanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
        </span>
        <Wrench size={13} className="text-kumo-subtle" />
        <span className="text-[12px] font-medium text-kumo-default">{message.content}</span>
      </button>

      {expanded && (
        <div className="mt-2 flex flex-col gap-2 rounded-lg border border-kumo-line bg-kumo-overlay px-3 py-2">
          {toolCalls.map((tool) => (
            <div key={tool.id} className="rounded-md bg-kumo-control border border-kumo-line px-2.5 py-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-kumo-default">{tool.name}</span>
                <span className={`text-[10px] ${toolStateStyles[tool.state] ?? 'text-kumo-link'}`}>
                  {tool.state}
                </span>
              </div>
              {summarizeToolInput(tool.name, tool.input) && (
                <pre className="mt-1.5 whitespace-pre-wrap break-all font-mono text-[10px] text-kumo-link bg-kumo-overlay rounded-md px-2 py-1.5 overflow-x-auto max-h-[120px]">
                  {summarizeToolInput(tool.name, tool.input)}
                </pre>
              )}
              {/* Live sub-agent progress for the `task` tool. The child
                  session's messages are already flowing through EventBridge →
                  useAgentStore; we just mirror them inline so the user can
                  watch what the sub-agent is doing. Rendered above the final
                  output so the transcript reads top-to-bottom. */}
              {tool.name === 'task' && (tool.state === 'running' || tool.childTranscript?.length) && (
                <div className="mt-2">
                  <CollapsibleSubagentProgress
                    tool={tool}
                    verbosity={verbosity}
                  />
                </div>
              )}
              {tool.output && (
                <pre className="mt-2 whitespace-pre-wrap break-all font-mono text-[10px] text-kumo-subtle bg-kumo-overlay rounded-md px-2 py-1.5 overflow-x-auto">
                  {tool.output}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}, (prev, next) =>
  prev.message.id === next.message.id &&
  prev.message.content === next.message.content &&
  prev.message.toolCalls === next.message.toolCalls &&
  prev.verbosity === next.verbosity
)

/**
 * Which banner the drawer should render, derived from the agent's transient
 * state. Computed once at the top of StatusBanner so the JSX stays flat.
 */
type BannerKind = 'compacting' | 'uncompactable' | 'overflow' | 'error'

function bannerKind(agent: AgentRuntime): BannerKind | null {
  if (agent.compacting) return 'compacting'
  if (!agent.lastError) return null
  // When compaction itself can't run (transcript already exceeds the provider's
  // context limit — even summarization needs to read it), opencode reports a
  // "prompt is too long" error. Compacting is not a valid recovery for this.
  if (agent.lastError.message?.includes('prompt is too long')) return 'uncompactable'
  if (agent.lastError.name === 'ContextOverflowError') return 'overflow'
  return 'error'
}

interface BannerContent {
  title: string
  body: string
  containerTone: string
  iconTone: string
}

function bannerContent(kind: BannerKind, agent: AgentRuntime): BannerContent {
  switch (kind) {
    case 'compacting':
      return {
        title: 'Compacting session…',
        body: 'Summarizing the conversation so far. This can take a few minutes for long sessions.',
        containerTone: 'border-kumo-brand/40 bg-kumo-brand/10',
        iconTone: 'text-kumo-brand'
      }
    case 'uncompactable':
      return {
        title: 'Session too large to compact',
        body: 'The transcript already exceeds the model\'s context window, so even compaction can\'t run. Your code changes are preserved in the worktree — start a fresh session below and it will reconstruct context from git history.',
        containerTone: 'border-kumo-danger/40 bg-kumo-danger/10',
        iconTone: 'text-kumo-danger'
      }
    case 'overflow':
      return {
        title: 'Context window full',
        body: 'This session is too long for the model to read in one pass. Compact the conversation to free up space, or switch to a model with a larger context window.',
        containerTone: 'border-kumo-warning/40 bg-kumo-warning/10',
        iconTone: 'text-kumo-warning'
      }
    case 'error':
      return {
        title: agent.lastError!.name,
        body: agent.lastError!.message ?? 'The server reported an error. Check the logs for details.',
        containerTone: 'border-kumo-danger/40 bg-kumo-danger/10',
        iconTone: 'text-kumo-danger'
      }
  }
}

function StatusBanner({
  agent,
  onCompact,
  onStartFreshSession,
  onDismissError
}: {
  agent: AgentRuntime
  onCompact?: () => void
  onStartFreshSession?: () => void
  onDismissError?: () => void
}) {
  const kind = bannerKind(agent)
  if (!kind) return null

  const { title, body, containerTone, iconTone } = bannerContent(kind, agent)
  const showCompact = kind === 'overflow' && !!onCompact
  const showStartFresh = kind === 'uncompactable' && !!onStartFreshSession
  // Every error is dismissible. The user decides when to compact, switch
  // models, or start fresh — we just surface the problem.
  const showDismiss = kind !== 'compacting' && !!onDismissError

  return (
    <div className={`flex items-start gap-2 px-3 py-2 border-t text-[11px] ${containerTone}`}>
      {kind === 'compacting'
        ? <CircleNotch size={14} weight="bold" className={`mt-0.5 shrink-0 animate-spin ${iconTone}`} />
        : <Warning size={14} weight="fill" className={`mt-0.5 shrink-0 ${iconTone}`} />
      }
      <div className="flex-1 min-w-0">
        <div className="font-medium text-kumo-default">{title}</div>
        <div className="text-kumo-subtle leading-snug mt-0.5">{body}</div>
      </div>
      <div className="flex flex-col gap-1 shrink-0">
        {showCompact && (
          <button
            type="button"
            onClick={onCompact}
            className="flex items-center gap-1 px-2 py-1 rounded-md bg-kumo-brand hover:bg-kumo-brand-hover text-white text-[11px] font-medium whitespace-nowrap"
          >
            <ArrowsInLineHorizontal size={11} weight="bold" />
            Compact
          </button>
        )}
        {showStartFresh && (
          <button
            type="button"
            onClick={onStartFreshSession}
            className="flex items-center gap-1 px-2 py-1 rounded-md bg-kumo-brand hover:bg-kumo-brand-hover text-white text-[11px] font-medium whitespace-nowrap"
          >
            <Rocket size={11} weight="bold" />
            Start fresh session
          </button>
        )}
        {showDismiss && (
          <button
            type="button"
            onClick={onDismissError}
            className="flex items-center gap-1 px-2 py-1 rounded-md border border-kumo-line hover:bg-kumo-fill text-kumo-default text-[11px] whitespace-nowrap"
          >
            <X size={11} />
            Dismiss
          </button>
        )}
      </div>
    </div>
  )
}

function ActionButton({
  icon,
  label,
  variant = 'default',
  disabled = false,
  onClick,
  className: extraClass
}: {
  icon: React.ReactNode
  label: string
  variant?: 'default' | 'approve' | 'deny'
  disabled?: boolean
  onClick?: () => void
  className?: string
}) {
  const styles = {
    default: 'bg-kumo-control border-kumo-line text-kumo-default hover:bg-kumo-fill',
    approve: 'bg-kumo-success/12 border-kumo-success/25 text-kumo-success hover:bg-kumo-success/20',
    deny: 'bg-kumo-danger/10 border-kumo-danger/20 text-kumo-danger hover:bg-kumo-danger/20'
  }

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-md border whitespace-nowrap transition-colors ${styles[variant]} ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${extraClass ?? ''}`}
    >
      {icon}
      {label}
    </button>
  )
}

function QuickActionButton({ action, onClick }: { action: QuickAction; onClick?: () => void }) {
  const Icon = quickActionIconMap[action.icon] ?? Lightning
  return (
    <ActionButton
      icon={<Icon size={12} />}
      label={action.label}
      onClick={onClick}
    />
  )
}

interface DropdownItem {
  icon: React.ReactNode
  label: string
  onClick?: () => void
  disabled?: boolean
}

function ActionDropdownButton({
  icon,
  label,
  items,
  className: extraClass
}: {
  icon: React.ReactNode
  label: string
  items: DropdownItem[]
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const visibleItems = items.filter((i) => i.onClick)
  if (visibleItems.length === 0) return null

  if (visibleItems.length === 1) {
    const item = visibleItems[0]
    return (
      <ActionButton
        icon={item.icon}
        label={item.label}
        onClick={item.onClick}
        disabled={item.disabled}
        className={extraClass}
      />
    )
  }

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1 w-full px-2.5 py-1.5 text-[11px] font-medium rounded-md border whitespace-nowrap bg-kumo-control border-kumo-line text-kumo-default hover:bg-kumo-fill transition-colors ${extraClass ?? ''}`}
      >
        {icon}
        {label}
        <CaretDown size={10} className="ml-0.5" />
      </button>
      <PortaledMenu
        open={open}
        triggerRef={buttonRef}
        placement="top-right"
        onDismiss={() => setOpen(false)}
        className="min-w-[140px] rounded-lg border border-kumo-line bg-kumo-elevated p-1 shadow-xl"
      >
        {visibleItems.map((item) => (
          <button
            key={item.label}
            disabled={item.disabled}
            onClick={() => {
              item.onClick?.()
              setOpen(false)
            }}
            className={`flex items-center gap-2 w-full px-2.5 py-1.5 text-[11px] rounded transition-colors text-left text-kumo-default hover:bg-kumo-fill ${item.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </PortaledMenu>
    </>
  )
}

function formatRelativeTime(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return 'just now'
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function extractToolName(content: string): string {
  // Try to extract tool name from patterns like "tool_name: output" or "[tool_name] output"
  const bracketMatch = content.match(/^\[([^\]]+)\]/)
  if (bracketMatch) return bracketMatch[1]
  const colonMatch = content.match(/^(\w[\w.]+):/)
  if (colonMatch) return colonMatch[1]
  return 'tool'
}

function extractToolOutput(content: string): string {
  const bracketMatch = content.match(/^\[[^\]]+\]\s*([\s\S]*)$/)
  if (bracketMatch) return bracketMatch[1]
  const colonMatch = content.match(/^\w[\w.]+:\s*([\s\S]*)$/)
  if (colonMatch) return colonMatch[1]
  return content
}
