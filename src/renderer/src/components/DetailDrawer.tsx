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
  CircleNotch
} from '@phosphor-icons/react'
import type { AgentRuntime, Message } from '../types'
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

interface DetailDrawerProps {
  agent: AgentRuntime
  messages: Message[]
  permission?: LivePermission | null
  files?: FileChange[]
  tools?: ToolCall[]
  events?: EventEntry[]
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
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  // Slide-in animation on mount
  useEffect(() => {
    const frame = requestAnimationFrame(() => setIsVisible(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (activeTab === 'transcript' && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, activeTab])

  const handleSend = () => {
    if (!inputText.trim() || !onSendMessage) return
    onSendMessage(inputText.trim())
    setInputText('')
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
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
                {agent.projectName} &middot; {agent.branchName || agent.taskSummary.slice(0, 40)}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-right mr-2">
              <div className="text-[10px] text-kumo-subtle font-mono">{agent.model}</div>
              {agent.lastActivityAt && (
                <div className="text-[10px] text-kumo-subtle font-mono">
                  {formatRelativeTime(new Date(agent.lastActivityAt).getTime())}
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
        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
          {activeTab === 'transcript' && (
            <>
              {messages.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-kumo-subtle text-sm">
                  Waiting for messages...
                </div>
              ) : (
                messages.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))
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
          <input
            type="text"
            value={inputText}
            onChange={(event) => setInputText(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Send a message to this agent..."
            className="flex-1 px-3 py-2 bg-kumo-control border border-kumo-line rounded-md text-kumo-default text-sm outline-none focus:border-kumo-ring placeholder:text-kumo-subtle"
          />
          <button
            onClick={handleSend}
            disabled={!inputText.trim()}
            className="px-3 py-2 bg-kumo-brand text-white text-xs font-medium rounded-md hover:bg-kumo-brand-hover transition-colors disabled:opacity-40"
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
  if (message.role === 'tool') {
    const toolName = extractToolName(message.content)
    const toolOutput = extractToolOutput(message.content)

    return (
      <div className="font-mono text-[11px] px-2.5 py-1.5 bg-kumo-overlay border-l-2 border-kumo-fill-hover rounded-r-md text-kumo-subtle">
        <div className="flex items-center gap-1.5 mb-0.5">
          <Wrench size={11} className="shrink-0" />
          <span className="font-semibold text-kumo-default">{toolName}</span>
          <CircleNotch size={11} className="text-kumo-success" />
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
