import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react'
import {
  X,
  Square,
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
  Brain,
  PaperPlaneTilt,
  Paperclip,
  ArrowLineUpRight,
  Link
} from '@phosphor-icons/react'
import type { AgentRuntime, Message, LabelDefinition, LabelColorKey } from '../types'
import { formatBranchLabel } from '../types'
import type { LivePermission, LiveQuestion } from '../hooks/useAgentStore'
import { loadSettings, SETTINGS_CHANGED_EVENT } from '../data/settings'
import { useImageAttachments } from '../hooks/useImageAttachments'
import { StatusBadge } from './StatusBadge'
import { LabelDropdown } from './LabelDropdown'
import { TextInputModal } from './TextInputModal'
import { Markdown } from './Markdown'
import { FilesChanged } from './FilesChanged'
import { ToolsUsage } from './ToolsUsage'
import { EventLog } from './EventLog'
import { useDismiss } from '../hooks/useDismiss'
import type { FileChange } from './FilesChanged'
import type { ToolCall } from './ToolsUsage'
import type { EventEntry } from './EventLog'

export type { FileChange, ToolCall, EventEntry }

const DRAWER_WIDTH_KEY = 'oc-orchestrator:drawer-width'
const DEFAULT_DRAWER_WIDTH = 600
const MIN_DRAWER_WIDTH = 400
const MAX_DRAWER_WIDTH = 1000
const INPUT_HEIGHT_KEY = 'oc-orchestrator:input-height'
const DEFAULT_INPUT_HEIGHT = 120
const MIN_INPUT_HEIGHT = 80
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
  return DEFAULT_INPUT_HEIGHT
}

type TabKey = 'transcript' | 'files' | 'tools' | 'events'

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
  messages: Message[]
  permission?: LivePermission | null
  question?: LiveQuestion | null
  files?: FileChange[]
  tools?: ToolCall[]
  events?: EventEntry[]
  commands?: ChatCommand[]
  agentConfigs?: AgentConfigItem[]
  sessionNotice?: string
  onClose: () => void
  onSendMessage?: (text: string, attachments?: Array<{ mime: string; dataUrl: string; filename?: string }>) => void
  onApprove?: () => void
  onDeny?: () => void
  onReplyQuestion?: (answers: string[][]) => void
  onRejectQuestion?: () => void
  onAbort?: () => void
  onRemove?: () => void
  onCreatePr?: () => void
  onSetPrUrl?: (prUrl: string | null) => void
  onOpenInEditor?: () => void
  onChangeModel?: () => void
  onOpenTerminal?: () => void
  onToggleLabel?: (labelId: string) => void
  onClearLabels?: () => void
  allLabels?: LabelDefinition[]
  onCreateLabel?: (name: string, colorKey: LabelColorKey) => Promise<LabelDefinition | null>
  onDeleteLabel?: (id: string) => Promise<boolean>
}

export const DetailDrawer = memo(function DetailDrawer({
  agent,
  messages,
  permission,
  question,
  files = [],
  tools = [],
  events = [],
  commands = [],
  agentConfigs = [],
  sessionNotice,
  onClose,
  onSendMessage,
  onApprove,
  onDeny,
  onReplyQuestion,
  onRejectQuestion,
  onAbort,
  onRemove,
  onCreatePr,
  onSetPrUrl,
  onOpenInEditor,
  onChangeModel,
  onOpenTerminal,
  onToggleLabel,
  onClearLabels,
  allLabels = [],
  onCreateLabel,
  onDeleteLabel
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

  // Verbose mode: global setting, reactive to changes from SettingsModal
  const [isVerbose, setIsVerbose] = useState(() => loadSettings().verboseMode)
  useEffect(() => {
    const onSettingsChanged = () => setIsVerbose(loadSettings().verboseMode)
    window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
  }, [])
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

  const matchingCommands = useMemo(
    () => inputText.startsWith('/')
      ? commands.filter(({ command }) => command.startsWith(trimmedInput))
      : [],
    [inputText, trimmedInput, commands]
  )

  const showCommandAutocomplete = useMemo(() => {
    if (matchingCommands.length === 0 || trimmedInput.length === 0) return false
    return !commands.some(({ command }) => command === trimmedInput)
  }, [matchingCommands, trimmedInput, commands])

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
    if (showCommandAutocomplete) {
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
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setCommandPickerIndex((prev) => (prev + 1) % matchingCommands.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setCommandPickerIndex((prev) => (prev - 1 + matchingCommands.length) % matchingCommands.length)
        return
      }
    }

    // ── Input history cycling (ArrowUp/ArrowDown) ──
    // Only activates on single-line input, or when cursor is at the boundary.
    const history = inputHistories.get(agent.id)
    if (history && history.length > 0) {
      const textarea = event.currentTarget as HTMLTextAreaElement
      const singleLine = !textarea.value.includes('\n')
      const atStart = textarea.selectionStart === 0 && textarea.selectionEnd === 0
      const atEnd = textarea.selectionStart === textarea.value.length && textarea.selectionEnd === textarea.value.length
      const fromEnd = (i: number) => history[history.length - 1 - i]

      if (event.key === 'ArrowUp' && (singleLine || atStart)) {
        const next = historyIndexRef.current + 1
        if (next < history.length) {
          event.preventDefault()
          if (historyIndexRef.current === -1) savedDraftRef.current = inputText
          historyIndexRef.current = next
          setInputText(fromEnd(next))
        }
        return
      }

      if (event.key === 'ArrowDown' && (singleLine || atEnd) && historyIndexRef.current >= 0) {
        event.preventDefault()
        historyIndexRef.current -= 1
        setInputText(historyIndexRef.current < 0 ? savedDraftRef.current : fromEnd(historyIndexRef.current))
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

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: 'transcript', label: 'Transcript', count: messages.length },
    { key: 'files', label: 'Files Changed', count: files.length },
    { key: 'tools', label: 'Tools', count: tools.length },
    { key: 'events', label: 'Events', count: events.length }
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

            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[10px] text-kumo-subtle font-mono whitespace-nowrap">
              {agent.model}
              {agent.lastActivityAtMs ? ` · ${formatRelativeTime(agent.lastActivityAtMs)}` : ''}
            </span>
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
        <div className="flex border-b border-kumo-line shrink-0">
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
                      <MessageBubble key={message.id} message={message} verbose={isVerbose} />
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
                          <Check size={12} weight="bold" /> Approve
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

                {/* Question card — show whenever we have question data, regardless of
                    agent status. The presence of a question in state is the authoritative
                    signal; status may lag behind due to event ordering races. */}
                {!permission && question && (
                  <QuestionCard
                    question={question}
                    onReply={onReplyQuestion}
                    onReject={onRejectQuestion}
                  />
                )}

                {/* Waiting for input (no structured question) */}
                {!permission && !question && agent.status === 'needs_input' && (
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

            {activeTab === 'files' && <FilesChanged files={files} />}
            {activeTab === 'tools' && <ToolsUsage tools={tools} verbose={isVerbose} />}
            {activeTab === 'events' && <EventLog events={events} verbose={isVerbose} />}
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
        <div
          onMouseDown={handleVerticalResizeStart}
          className="h-1.5 shrink-0 cursor-row-resize group flex items-center justify-center border-t border-kumo-line"
        >
          <div className="h-px w-8 rounded-full bg-kumo-subtle/30 group-hover:bg-kumo-brand/50 transition-colors" />
        </div>

        {/* Bottom pane — action rail + input, resizable height */}
        <div style={{ height: inputHeight }} className="shrink-0 flex flex-col min-h-0">
        {/* Action Rail */}
        <div className="flex gap-1 px-3 py-1.5 border-t border-kumo-line shrink-0">
          {onApprove && (
            <ActionButton icon={<Check size={12} weight="bold" />} label="Approve" variant="approve" onClick={onApprove} />
          )}
          {onDeny && (
            <ActionButton icon={<XCircle size={12} />} label="Deny" variant="deny" onClick={onDeny} />
          )}
          {onAbort && (agent.status === 'running' || agent.status === 'needs_approval' || agent.status === 'needs_input' || agent.status === 'stopping') && (
            <ActionButton icon={<Square size={12} weight="fill" />} label={agent.status === 'stopping' ? 'Stopping…' : 'Stop'} onClick={onAbort} disabled={agent.status === 'stopping'} />
          )}
          {onToggleLabel && onClearLabels && (
            <LabelDropdown
              current={agent.labelIds}
              onToggle={onToggleLabel}
              onClear={onClearLabels}
              allLabels={allLabels}
              onCreateLabel={onCreateLabel}
              onDeleteLabel={onDeleteLabel}
              variant="action"
            />
          )}
          <div className="flex-1" />
          {onChangeModel && (
            <ActionButton icon={<Brain size={12} />} label="Model" onClick={onChangeModel} />
          )}
          <ActionDropdownButton
            icon={<GitPullRequest size={12} />}
            label="PR"
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
          <ActionDropdownButton
            icon={<ArrowSquareOut size={12} />}
            label="Open In"
            items={[
              { icon: <Terminal size={12} />, label: 'Terminal', onClick: onOpenTerminal },
              { icon: <ArrowSquareOut size={12} />, label: 'Editor', onClick: onOpenInEditor }
            ]}
          />
        </div>

        {/* Input */}
        <div
          className={`flex flex-col gap-0 px-3 py-2 border-t flex-1 min-h-0 transition-colors ${
            isDragOver ? 'border-kumo-brand bg-kumo-brand/[0.04]' : 'border-kumo-line'
          }`}
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {attachments.length > 0 && (
            <div className="flex gap-2 px-1 py-1.5 overflow-x-auto">
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

          <div className="flex gap-2 flex-1 min-h-0">
            <div className="relative flex-1 flex flex-col gap-1 min-h-0">
              {showCommandAutocomplete && (
                <div className="absolute bottom-full left-0 right-0 z-20 mb-2 rounded-lg border border-kumo-line bg-kumo-overlay p-1 shadow-xl">
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
                </div>
              )}
              {showAgentPicker && (
                <div className="absolute bottom-full left-0 right-0 z-20 mb-2 rounded-lg border border-kumo-line bg-kumo-overlay p-1 shadow-xl">
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
                </div>
              )}
              <textarea
                ref={textareaRef}
                value={inputText}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onKeyUp={(e) => setCursorPos(e.currentTarget.selectionStart)}
                onClick={(e) => setCursorPos(e.currentTarget.selectionStart)}
                onPaste={handlePaste}
                placeholder={inputPlaceholder}
                className={`w-full flex-1 min-h-0 px-3 py-2 bg-kumo-control border rounded-md text-kumo-default text-sm outline-none placeholder:text-kumo-subtle resize-none transition-colors ${
                  isDragOver ? 'border-kumo-brand' : 'border-kumo-line focus:border-kumo-ring'
                }`}
              />
              <div className="flex items-center gap-2 px-1">
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
                <span className="text-[10px] text-kumo-subtle">
                  Enter to send. Shift+Enter for new line. Paste or drag images.
                </span>
              </div>
            </div>
            <button
              onClick={handleSend}
              disabled={!inputText.trim() && attachments.length === 0}
              className={`self-end px-3 py-2 text-white text-xs font-medium rounded-md transition-colors disabled:opacity-40 ${
                canReplyViaChat ? 'bg-status-input hover:bg-status-input/80' : 'bg-kumo-brand hover:bg-kumo-brand-hover'
              }`}
            >
              {canReplyViaChat ? 'Reply' : 'Send'}
            </button>
           </div>
        </div>
        </div>{/* end bottom pane */}
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
      className={`px-4 py-2 text-xs font-medium cursor-pointer border-b-2 transition-colors flex items-center gap-1.5 ${
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

const MessageBubble = memo(function MessageBubble({ message, verbose = false }: { message: Message; verbose?: boolean }) {
  if (message.role === 'tool-group') {
    return <ToolGroupBubble message={message} verbose={verbose} />
  }

  if (message.role === 'tool') {
    const toolName = message.toolName ?? extractToolName(message.content)
    const toolOutput = message.content ? extractToolOutput(message.content) : ''
    return (
      <div className="font-mono text-[11px] px-2.5 py-1.5 bg-kumo-overlay border-l-2 border-kumo-fill-hover rounded-r-md text-kumo-subtle">
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

  return (
    <div
      className={`px-3 py-2.5 rounded-lg text-[13px] leading-relaxed ${
        isUser
          ? 'bg-kumo-interact/10 border border-kumo-interact/15 text-kumo-default self-end max-w-[85%]'
          : 'bg-kumo-control border border-kumo-line text-kumo-default max-w-[95%]'
      }`}
    >
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
  prev.verbose === next.verbose
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

const ToolGroupBubble = memo(function ToolGroupBubble({ message, verbose = false }: { message: Message; verbose?: boolean }) {
  const [expanded, setExpanded] = useState(verbose)
  const toolCalls = message.toolCalls ?? []

  // Sync with verbose prop changes (e.g. user toggles verbose mode)
  useEffect(() => {
    if (verbose) setExpanded(true)
  }, [verbose])

  return (
    <div className="max-w-[95%] self-start">
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
  prev.verbose === next.verbose
)

function ActionButton({
  icon,
  label,
  variant = 'default',
  disabled = false,
  onClick
}: {
  icon: React.ReactNode
  label: string
  variant?: 'default' | 'approve' | 'deny'
  disabled?: boolean
  onClick?: () => void
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
      className={`flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-md border transition-colors ${styles[variant]} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      {icon}
      {label}
    </button>
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
  items
}: {
  icon: React.ReactNode
  label: string
  items: DropdownItem[]
}) {
  const { open, toggle, close, containerRef } = useDismiss()

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
      />
    )
  }

  return (
    <div ref={containerRef} className="relative inline-flex">
      <button
        onClick={toggle}
        className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-md border bg-kumo-control border-kumo-line text-kumo-default hover:bg-kumo-fill transition-colors"
      >
        {icon}
        {label}
        <CaretDown size={10} className="ml-0.5" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-1 z-[100] min-w-[140px] rounded-lg border border-kumo-line bg-kumo-elevated p-1 shadow-xl">
          {visibleItems.map((item) => (
            <button
              key={item.label}
              disabled={item.disabled}
              onClick={() => {
                item.onClick?.()
                close()
              }}
              className={`flex items-center gap-2 w-full px-2.5 py-1.5 text-[11px] rounded transition-colors text-left text-kumo-default hover:bg-kumo-fill ${item.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
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
