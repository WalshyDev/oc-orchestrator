import { useState, useEffect, useRef, useCallback } from 'react'
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
  Brain
} from '@phosphor-icons/react'
import type { AgentRuntime, Message } from '../types'
import { formatBranchLabel } from '../types'
import type { LivePermission, LiveQuestion } from '../hooks/useAgentStore'
import { StatusBadge } from './StatusBadge'
import { Markdown } from './Markdown'
import { FilesChanged } from './FilesChanged'
import { ToolsUsage } from './ToolsUsage'
import { EventLog } from './EventLog'
import type { FileChange } from './FilesChanged'
import type { ToolCall } from './ToolsUsage'
import type { EventEntry } from './EventLog'

export type { FileChange, ToolCall, EventEntry }

const DRAWER_WIDTH_KEY = 'oc-orchestrator:drawer-width'
const DEFAULT_DRAWER_WIDTH = 600
const MIN_DRAWER_WIDTH = 400
const MAX_DRAWER_WIDTH = 1000

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

type TabKey = 'transcript' | 'files' | 'tools' | 'events'

export interface ChatCommand {
  command: string
  description: string
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
  sessionNotice?: string
  onClose: () => void
  onSendMessage?: (text: string) => void
  onApprove?: () => void
  onDeny?: () => void
  onReplyQuestion?: (answers: string[][]) => void
  onRejectQuestion?: () => void
  onAbort?: () => void
  onRemove?: () => void
  onCreatePr?: () => void
  onOpenInEditor?: () => void
  onChangeModel?: () => void
  onOpenTerminal?: () => void
}

export function DetailDrawer({
  agent,
  messages,
  permission,
  question,
  files = [],
  tools = [],
  events = [],
  commands = [],
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
  onOpenInEditor,
  onChangeModel,
  onOpenTerminal
}: DetailDrawerProps) {
  const [inputText, setInputText] = useState('')
  const [activeTab, setActiveTab] = useState<TabKey>('transcript')
  const [isVisible, setIsVisible] = useState(false)
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)
  const [drawerWidth, setDrawerWidth] = useState(loadDrawerWidth)
  const transcriptScrollRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const shouldAutoScrollRef = useRef(true)
  const userScrolledRef = useRef(false)
  const isResizingRef = useRef(false)

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

  const matchingCommands = inputText.startsWith('/')
    ? commands.filter(({ command }) => command.startsWith(inputText.trim().toLowerCase()))
    : []

  const showCommandAutocomplete = matchingCommands.length > 0 && inputText.trim().length > 0

  // Slide-in animation on mount
  useEffect(() => {
    const frame = requestAnimationFrame(() => setIsVisible(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  // Auto-scroll to bottom when new messages arrive.
  // Uses 'instant' scroll to avoid smooth animations fighting with user scrolling.
  // Once the user manually scrolls up, auto-scroll is disabled until they scroll
  // back to the bottom (within threshold) on their own.
  useEffect(() => {
    if (activeTab === 'transcript' && messagesEndRef.current && shouldAutoScrollRef.current && !userScrolledRef.current) {
      setShowJumpToLatest(false)
      messagesEndRef.current.scrollIntoView({ behavior: 'instant' })
    } else if (activeTab === 'transcript' && messages.length > 0 && !shouldAutoScrollRef.current) {
      setShowJumpToLatest(true)
    }
  }, [messages, activeTab])

  // Reset user-scrolled lock when switching to transcript tab
  useEffect(() => {
    if (activeTab === 'transcript') {
      userScrolledRef.current = false
      shouldAutoScrollRef.current = true
    }
  }, [activeTab])

  const handleTranscriptScroll = () => {
    const container = transcriptScrollRef.current
    if (!container) return

    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    const isNearBottom = distanceFromBottom < 48

    if (isNearBottom) {
      // User scrolled back to bottom — re-enable auto-scroll
      shouldAutoScrollRef.current = true
      userScrolledRef.current = false
      setShowJumpToLatest(false)
    } else {
      // User scrolled away from bottom — disable auto-scroll
      shouldAutoScrollRef.current = false
      userScrolledRef.current = true
    }
  }

  const handleJumpToLatest = () => {
    shouldAutoScrollRef.current = true
    userScrolledRef.current = false
    setShowJumpToLatest(false)
    messagesEndRef.current?.scrollIntoView({ behavior: 'instant' })
  }

  const handleSend = () => {
    if (!inputText.trim() || !onSendMessage) return
    onSendMessage(inputText.trim())
    setInputText('')
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Tab' && showCommandAutocomplete) {
      event.preventDefault()
      setInputText(`${matchingCommands[0].command} `)
      return
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

        {/* Tab Content */}
        <div
          ref={transcriptScrollRef}
          onScroll={activeTab === 'transcript' ? handleTranscriptScroll : undefined}
          className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2"
        >
          {activeTab === 'transcript' && (
            <>
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
                  {messages.map((message) => (
                    <MessageBubble key={message.id} message={message} />
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

              {/* Question card */}
              {!permission && question && agent.status === 'needs_input' && (
                <div className="bg-status-input-bg/30 border border-status-input/20 rounded-lg p-3 flex flex-col gap-2">
                  <div className="text-xs font-semibold text-status-input flex items-center gap-1.5">
                    <ChatCircleDots size={14} weight="fill" /> Question
                  </div>
                  {question.questions.map((q, qi) => (
                    <div key={qi} className="flex flex-col gap-1.5">
                      {q.header && (
                        <div className="text-xs font-medium text-kumo-default">{q.header}</div>
                      )}
                      <div className="text-xs text-kumo-subtle">{q.question}</div>
                      {q.options.length > 0 && (
                        <div className="flex flex-col gap-1 mt-1">
                          {q.options.map((opt, oi) => (
                            <button
                              key={oi}
                              type="button"
                              onClick={() => onReplyQuestion?.([[opt.label]])}
                              className="flex flex-col items-start px-2.5 py-1.5 text-left text-[11px] rounded-md bg-kumo-overlay border border-kumo-interact/20 hover:border-status-input/40 hover:bg-status-input-bg/20 transition-colors"
                            >
                              <span className="font-medium text-kumo-default">{opt.label}</span>
                              {opt.description && (
                                <span className="text-kumo-subtle">{opt.description}</span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  {onRejectQuestion && (
                    <button
                      type="button"
                      onClick={onRejectQuestion}
                      className="self-start flex items-center gap-1 px-2.5 py-1.5 mt-1 text-[11px] font-medium rounded-md bg-kumo-danger/10 border border-kumo-danger/20 text-kumo-danger hover:bg-kumo-danger/20 transition-colors"
                    >
                      <XCircle size={12} /> Dismiss
                    </button>
                  )}
                </div>
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

              {showJumpToLatest && activeTab === 'transcript' && (
                <div className="sticky bottom-2 z-10 flex justify-center">
                  <button
                    type="button"
                    onClick={handleJumpToLatest}
                    className="inline-flex items-center gap-1.5 rounded-full border border-kumo-interact/30 bg-kumo-interact/12 px-3 py-1.5 text-[11px] font-medium text-kumo-link shadow-lg backdrop-blur hover:bg-kumo-interact/18 transition-colors"
                  >
                    <CaretDown size={12} />
                    Jump to latest
                  </button>
                </div>
              )}

              <div ref={messagesEndRef} />
            </>
          )}

          {activeTab === 'files' && <FilesChanged files={files} />}
          {activeTab === 'tools' && <ToolsUsage tools={tools} />}
          {activeTab === 'events' && <EventLog events={events} />}
        </div>

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
          <div className="flex-1" />
          {onChangeModel && (
            <ActionButton icon={<Brain size={12} />} label="Model" onClick={onChangeModel} />
          )}
          {onCreatePr && (
            <ActionButton icon={<GitPullRequest size={12} />} label="Create PR" onClick={onCreatePr} />
          )}
          <ActionButton icon={<Terminal size={12} />} label="Terminal" onClick={onOpenTerminal} />
          <ActionButton icon={<ArrowSquareOut size={12} />} label="Editor" onClick={onOpenInEditor} />
        </div>

        {/* Input */}
        <div className="flex gap-2 px-3 py-2 border-t border-kumo-line shrink-0">
          <div className="relative flex-1 flex flex-col gap-1">
            {showCommandAutocomplete && (
              <div className="absolute bottom-full left-0 right-0 z-20 mb-2 rounded-lg border border-kumo-line bg-kumo-overlay p-1 shadow-xl">
                {matchingCommands.map((item) => (
                  <button
                    key={item.command}
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault()
                      setInputText(`${item.command} `)
                    }}
                    className="flex w-full items-start gap-3 rounded-md px-2.5 py-2 text-left hover:bg-kumo-fill transition-colors"
                  >
                    <span className="font-mono text-[11px] text-kumo-default">{item.command}</span>
                    <span className="text-[11px] text-kumo-subtle">{item.description}</span>
                  </button>
                ))}
              </div>
            )}
            <textarea
              value={inputText}
              onChange={(event) => setInputText(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Send a message to this agent... Type / for commands."
              rows={3}
              className="w-full px-3 py-2 bg-kumo-control border border-kumo-line rounded-md text-kumo-default text-sm outline-none focus:border-kumo-ring placeholder:text-kumo-subtle resize-none"
            />
            <div className="px-1 text-[10px] text-kumo-subtle">
              Enter to send. Shift+Enter for a new line. Use Tab to autocomplete commands.
            </div>
          </div>
          <button
            onClick={handleSend}
            disabled={!inputText.trim()}
            className="self-start px-3 py-2 bg-kumo-brand text-white text-xs font-medium rounded-md hover:bg-kumo-brand-hover transition-colors disabled:opacity-40"
          >
            Send
          </button>
        </div>
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

function MessageBubble({ message }: { message: Message }) {
  if (message.role === 'tool-group') {
    return <ToolGroupBubble message={message} />
  }

  if (message.role === 'tool') {
    const toolName = message.toolName ?? extractToolName(message.content)
    const toolOutput = message.content ? extractToolOutput(message.content) : ''
    const toolIconClass = message.toolState === 'failed'
      ? 'text-kumo-danger'
      : message.toolState === 'completed'
        ? 'text-kumo-success'
        : 'text-kumo-link animate-spin'

    return (
      <div className="font-mono text-[11px] px-2.5 py-1.5 bg-kumo-overlay border-l-2 border-kumo-fill-hover rounded-r-md text-kumo-subtle">
        <div className="flex items-center gap-1.5 mb-0.5">
          <Wrench size={11} className="shrink-0" />
          <span className="font-semibold text-kumo-default">{toolName}</span>
          <CircleNotch size={11} className={toolIconClass} />
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
      {isUser
        ? <div className="whitespace-pre-wrap">{message.content}</div>
        : <Markdown>{message.content}</Markdown>
      }
    </div>
  )
}

function ToolGroupBubble({ message }: { message: Message }) {
  const [expanded, setExpanded] = useState(false)
  const toolCalls = message.toolCalls ?? []

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
                <span className={`text-[10px] ${tool.state === 'failed' ? 'text-kumo-danger' : tool.state === 'completed' ? 'text-kumo-success' : 'text-kumo-link'}`}>
                  {tool.state}
                </span>
              </div>
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
}

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
