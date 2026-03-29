import { useState, useEffect, useRef } from 'react'
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
  CaretRight
} from '@phosphor-icons/react'
import type { AgentRuntime, Message } from '../types'
import { formatBranchLabel } from '../types'
import type { LivePermission } from '../hooks/useAgentStore'
import { StatusBadge } from './StatusBadge'
import { FilesChanged } from './FilesChanged'
import { ToolsUsage } from './ToolsUsage'
import { EventLog } from './EventLog'
import type { FileChange } from './FilesChanged'
import type { ToolCall } from './ToolsUsage'
import type { EventEntry } from './EventLog'

export type { FileChange, ToolCall, EventEntry }

type TabKey = 'transcript' | 'files' | 'tools' | 'events'

const CHAT_COMMANDS = [
  {
    command: '/new',
    description: 'Start a fresh agent with clean context and a new worktree'
  }
]

interface DetailDrawerProps {
  agent: AgentRuntime
  messages: Message[]
  permission?: LivePermission | null
  files?: FileChange[]
  tools?: ToolCall[]
  events?: EventEntry[]
  sessionNotice?: string
  onClose: () => void
  onSendMessage?: (text: string) => void
  onApprove?: () => void
  onDeny?: () => void
  onAbort?: () => void
  onCreatePr?: () => void
  onOpenInEditor?: () => void
}

export function DetailDrawer({
  agent,
  messages,
  permission,
  files = [],
  tools = [],
  events = [],
  sessionNotice,
  onClose,
  onSendMessage,
  onApprove,
  onDeny,
  onAbort,
  onCreatePr,
  onOpenInEditor
}: DetailDrawerProps) {
  const [inputText, setInputText] = useState('')
  const [activeTab, setActiveTab] = useState<TabKey>('transcript')
  const [isVisible, setIsVisible] = useState(false)
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)
  const transcriptScrollRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const shouldAutoScrollRef = useRef(true)

  const matchingCommands = inputText.startsWith('/')
    ? CHAT_COMMANDS.filter(({ command }) => command.startsWith(inputText.trim().toLowerCase()))
    : []

  const showCommandAutocomplete = matchingCommands.length > 0 && inputText.trim().length > 0

  // Slide-in animation on mount
  useEffect(() => {
    const frame = requestAnimationFrame(() => setIsVisible(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (activeTab === 'transcript' && messagesEndRef.current && shouldAutoScrollRef.current) {
      setShowJumpToLatest(false)
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    } else if (activeTab === 'transcript' && messages.length > 0) {
      setShowJumpToLatest(true)
    }
  }, [messages, activeTab])

  const handleTranscriptScroll = () => {
    const container = transcriptScrollRef.current
    if (!container) return

    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    shouldAutoScrollRef.current = distanceFromBottom < 48
    if (shouldAutoScrollRef.current) {
      setShowJumpToLatest(false)
    }
  }

  const handleJumpToLatest = () => {
    shouldAutoScrollRef.current = true
    setShowJumpToLatest(false)
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
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

    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
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
        className={`absolute top-0 right-0 w-[520px] h-full bg-kumo-elevated border-l border-kumo-line flex flex-col shadow-[-8px_0_32px_rgba(0,0,0,0.4)] transition-transform duration-200 ease-out ${
          isVisible ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-kumo-line shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={handleCloseWithAnimation}
              className="w-7 h-7 flex items-center justify-center border border-kumo-line rounded-md text-kumo-subtle hover:text-kumo-default hover:bg-kumo-fill transition-colors"
            >
              <X size={14} />
            </button>
            <div>
              <div className="font-semibold text-sm text-kumo-strong">{agent.name}</div>
              <div className="text-[11px] text-kumo-subtle">
                {agent.projectName}
                {agent.isWorktree ? ` · worktree:${agent.workspaceName}` : ''}
                {' · '}
                {formatBranchLabel(agent) || agent.taskSummary.slice(0, 40)}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-right mr-2">
              <div className="text-[10px] text-kumo-subtle font-mono">{agent.model}</div>
              {agent.lastActivityAtMs && (
                <div className="text-[10px] text-kumo-subtle font-mono">
                  {formatRelativeTime(agent.lastActivityAtMs)}
                </div>
              )}
            </div>
            <StatusBadge status={agent.status} />
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
        <div className="flex gap-1.5 px-4 py-2 border-t border-kumo-line shrink-0">
          {onApprove && (
            <ActionButton icon={<Check size={12} weight="bold" />} label="Approve" variant="approve" onClick={onApprove} />
          )}
          {onDeny && (
            <ActionButton icon={<XCircle size={12} />} label="Deny" variant="deny" onClick={onDeny} />
          )}
          {onAbort && (agent.status === 'running' || agent.status === 'needs_approval' || agent.status === 'needs_input') && (
            <ActionButton icon={<Square size={12} weight="fill" />} label="Stop" onClick={onAbort} />
          )}
          <div className="flex-1" />
          {onCreatePr && (
            <ActionButton icon={<GitPullRequest size={12} />} label="Create PR" onClick={onCreatePr} />
          )}
          <ActionButton icon={<Terminal size={12} />} label="Open Terminal" />
          <ActionButton icon={<ArrowSquareOut size={12} />} label="Open in Editor" onClick={onOpenInEditor} />
        </div>

        {/* Input */}
        <div className="flex gap-2 px-4 py-3 border-t border-kumo-line shrink-0">
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
              placeholder="Send a message to this agent... Use /new to start clean."
              rows={3}
              className="w-full px-3 py-2 bg-kumo-control border border-kumo-line rounded-md text-kumo-default text-sm outline-none focus:border-kumo-ring placeholder:text-kumo-subtle resize-none"
            />
            <div className="px-1 text-[10px] text-kumo-subtle">
              Enter adds a new line. Press Cmd+Enter or Ctrl+Enter to send. Use Tab to autocomplete `/new`.
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
      <div className="whitespace-pre-wrap">{message.content}</div>
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
  onClick
}: {
  icon: React.ReactNode
  label: string
  variant?: 'default' | 'approve' | 'deny'
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
      className={`flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-md border transition-colors ${styles[variant]}`}
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
