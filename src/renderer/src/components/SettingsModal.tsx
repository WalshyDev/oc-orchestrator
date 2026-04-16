import { useEffect, useRef, useState } from 'react'
import {
  X,
  GearSix,
  Keyboard,
  Info,
  Lightning,
  GitPullRequest,
  Rocket,
  Terminal as TerminalIcon,
  Code,
  CheckCircle,
  PaperPlaneTilt,
  Wrench,
  Plus,
  Trash,
  CaretDown,
  DotsSixVertical,
} from '@phosphor-icons/react'
import { SelectField } from './SelectField'
import {
  DEFAULT_CREATE_PR_PROMPT,
  MAX_QUICK_ACTIONS,
  isQuickActionValid,
  loadSettings,
  saveSettings,
  type AppSettings,
  type NotificationPrefs,
  type QuickAction,
  type QuickActionIcon,
  type QuickActionSlots,
} from '../data/settings'
import { useModelOptions } from '../hooks/useModelOptions'

const EDITOR_OPTIONS = [
  { value: 'vscode', label: 'VS Code' },
  { value: 'cursor', label: 'Cursor' },
  { value: 'windsurf', label: 'Windsurf' },
  { value: 'goland', label: 'GoLand' },
  { value: 'custom', label: 'Custom Command' },
] as const

const TERMINAL_OPTIONS = [
  { value: 'default', label: 'Default (Terminal.app)' },
  { value: 'iTerm', label: 'iTerm2' },
  { value: 'Warp', label: 'Warp' },
  { value: 'Alacritty', label: 'Alacritty' },
  { value: 'kitty', label: 'Kitty' },
  { value: 'Ghostty', label: 'Ghostty' },
] as const

const KEYBOARD_SHORTCUTS = [
  { key: 'Cmd+N', action: 'Launch New Agent', scope: 'Global' },
  { key: 'Cmd+,', action: 'Open Settings', scope: 'Global' },
  { key: 'Cmd+K', action: 'Focus Search / Filter', scope: 'Global' },
  { key: 'Escape', action: 'Close Modal / Drawer', scope: 'Global' },
  { key: 'J / K', action: 'Navigate Table Rows', scope: 'Table' },
  { key: 'Enter', action: 'Open Agent Detail', scope: 'Table' },
  { key: 'I', action: 'Interrupt Agent', scope: 'Drawer' },
  { key: 'A', action: 'Approve Pending Tool', scope: 'Drawer' },
]

const ICON_OPTIONS: { value: QuickActionIcon; label: string; icon: typeof GitPullRequest }[] = [
  { value: 'git-pull-request', label: 'PR', icon: GitPullRequest },
  { value: 'rocket', label: 'Rocket', icon: Rocket },
  { value: 'lightning', label: 'Lightning', icon: Lightning },
  { value: 'terminal', label: 'Terminal', icon: TerminalIcon },
  { value: 'code', label: 'Code', icon: Code },
  { value: 'check-circle', label: 'Check', icon: CheckCircle },
  { value: 'paper-plane', label: 'Send', icon: PaperPlaneTilt },
  { value: 'wrench', label: 'Wrench', icon: Wrench },
]

function getIconComponent(iconKey: QuickActionIcon): typeof GitPullRequest {
  return ICON_OPTIONS.find((o) => o.value === iconKey)?.icon ?? Lightning
}

export type SettingsTabId = 'general' | 'quick-actions' | 'shortcuts' | 'about'

export interface ChatCommandOption {
  command: string
  description: string
}

interface SettingsModalProps {
  onClose: () => void
  initialTab?: SettingsTabId
  commands?: ChatCommandOption[]
}

const TAB_LIST: { id: SettingsTabId; label: string; icon: typeof GearSix }[] = [
  { id: 'general', label: 'General', icon: GearSix },
  { id: 'quick-actions', label: 'Quick Actions', icon: Lightning },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'about', label: 'About', icon: Info },
]

export function SettingsModal({ onClose, initialTab = 'general', commands = [] }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>(initialTab)
  const [settings, setSettings] = useState(loadSettings)
  const [appVersion, setAppVersion] = useState<string>('')
  const { options: modelOptions } = useModelOptions()

  useEffect(() => {
    window.api.getVersion().then((result) => {
      if (result.ok && result.data) setAppVersion(result.data)
    })
  }, [])

  const updateSettings = (partial: Partial<AppSettings>) => {
    const updated = { ...settings, ...partial }
    setSettings(updated)
    saveSettings(updated)
  }

  const updateNotification = (key: keyof NotificationPrefs, value: boolean) => {
    const updated = { ...settings, notifications: { ...settings.notifications, [key]: value } }
    setSettings(updated)
    saveSettings(updated)
    window.api.setNotificationPreference(key, value)
  }

  const selectButtonClasses =
    'flex w-full items-center justify-between gap-3 rounded-md border border-kumo-line bg-kumo-control px-3 py-2 text-sm text-kumo-default outline-none transition-colors hover:bg-kumo-fill focus:border-kumo-ring'

  const selectMenuClasses =
    'absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-kumo-line bg-kumo-overlay shadow-xl'

  const inputClasses =
    'w-full px-3 py-2 bg-kumo-control border border-kumo-line rounded-md text-sm text-kumo-default outline-none focus:border-kumo-ring placeholder:text-kumo-subtle'

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[640px] max-h-[80vh] bg-kumo-elevated border border-kumo-line rounded-xl shadow-2xl flex flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-kumo-line">
          <h2 className="text-base font-semibold text-kumo-strong">Settings</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md border border-kumo-line text-kumo-subtle hover:text-kumo-default hover:bg-kumo-fill transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-kumo-line px-5">
          {TAB_LIST.map((tab) => {
            const TabIcon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'text-kumo-strong border-kumo-brand'
                    : 'text-kumo-subtle border-transparent hover:text-kumo-default'
                }`}
              >
                <TabIcon size={14} />
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {activeTab === 'general' && (
            <div className="flex flex-col gap-5">
              {/* Default Model */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-kumo-subtle uppercase tracking-wide">
                  Default Model
                </label>
                <div className="relative">
                  <SelectField
                    value={settings.model}
                    onChange={(value) => updateSettings({ model: value })}
                    options={modelOptions}
                    buttonClassName={selectButtonClasses}
                    menuClassName={selectMenuClasses}
                  />
                </div>
                <p className="text-[11px] text-kumo-subtle">
                  Pre-selected model when launching new agents. &quot;System Default&quot; uses the model from the project&apos;s opencode config.
                </p>
              </div>

              {/* Default Editor */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-kumo-subtle uppercase tracking-wide">
                  Default Editor
                </label>
                <div className="relative">
                  <SelectField
                    value={settings.editor}
                    onChange={(value) => updateSettings({ editor: value })}
                    options={EDITOR_OPTIONS}
                    buttonClassName={selectButtonClasses}
                    menuClassName={selectMenuClasses}
                  />
                </div>
                {settings.editor === 'custom' && (
                  <input
                    type="text"
                    value={settings.customEditorCommand}
                    onChange={(event) => updateSettings({ customEditorCommand: event.target.value })}
                    placeholder="e.g. /usr/local/bin/my-editor"
                    className={`${inputClasses} font-mono mt-1`}
                  />
                )}
              </div>

              {/* Terminal */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-kumo-subtle uppercase tracking-wide">
                  Terminal
                </label>
                <div className="relative">
                  <SelectField
                    value={settings.terminal}
                    onChange={(value) => updateSettings({ terminal: value })}
                    options={TERMINAL_OPTIONS}
                    buttonClassName={selectButtonClasses}
                    menuClassName={selectMenuClasses}
                  />
                </div>
              </div>

              {/* Notify When */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium text-kumo-subtle uppercase tracking-wide">
                  Notify When
                </label>
                <div className="flex flex-col gap-2 pl-1">
                  {(
                    [
                      { key: 'needs_approval', label: 'Needs Approval' },
                      { key: 'needs_input', label: 'Needs Input' },
                      { key: 'errored', label: 'Errored' },
                      { key: 'completed', label: 'Completed' },
                    ] as const
                  ).map((pref) => (
                    <label key={pref.key} className="flex items-center gap-2.5 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={settings.notifications[pref.key]}
                        onChange={(event) => updateNotification(pref.key, event.target.checked)}
                        className="w-3.5 h-3.5 rounded border-kumo-line bg-kumo-control accent-kumo-brand"
                      />
                      <span className="text-sm text-kumo-default group-hover:text-kumo-strong transition-colors">
                        {pref.label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Notification Sound */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium text-kumo-subtle uppercase tracking-wide">
                  Notification Sound
                </label>
                <label className="flex items-center gap-2.5 cursor-pointer group pl-1">
                  <input
                    type="checkbox"
                    checked={settings.soundEnabled}
                    onChange={(event) => {
                      updateSettings({ soundEnabled: event.target.checked })
                      window.api.setSoundEnabled(event.target.checked)
                    }}
                    className="w-3.5 h-3.5 rounded border-kumo-line bg-kumo-control accent-kumo-brand"
                  />
                  <span className="text-sm text-kumo-default group-hover:text-kumo-strong transition-colors">
                    Play sound with notifications
                  </span>
                </label>
              </div>

              {/* Verbose Mode */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium text-kumo-subtle uppercase tracking-wide">
                  Output Visibility
                </label>
                <label className="flex items-center gap-2.5 cursor-pointer group pl-1">
                  <input
                    type="checkbox"
                    checked={settings.verboseMode}
                    onChange={(event) => updateSettings({ verboseMode: event.target.checked })}
                    className="w-3.5 h-3.5 rounded border-kumo-line bg-kumo-control accent-kumo-brand"
                  />
                  <span className="text-sm text-kumo-default group-hover:text-kumo-strong transition-colors">
                    Verbose Mode
                  </span>
                </label>
                <p className="text-[11px] text-kumo-subtle">
                  Auto-expand all tool calls, tool output, and events in agent detail views. Can be toggled per-agent in the drawer header.
                </p>
              </div>

              {/* Create PR Prompt */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs font-medium text-kumo-subtle uppercase tracking-wide">
                    Create PR Prompt
                  </label>
                  <button
                    type="button"
                    onClick={() => updateSettings({ createPrPrompt: DEFAULT_CREATE_PR_PROMPT })}
                    className="text-[11px] font-medium text-kumo-link hover:underline"
                  >
                    Reset to default
                  </button>
                </div>
                <textarea
                  value={settings.createPrPrompt}
                  onChange={(event) => updateSettings({ createPrPrompt: event.target.value })}
                  placeholder="Instructions to send when using Create PR"
                  rows={8}
                  className={`${inputClasses} min-h-40 resize-y leading-6`}
                />
                <p className="text-[11px] text-kumo-subtle">
                  This prompt is sent when you click Create PR in the agent drawer.
                </p>
              </div>

              {/* Theme */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-kumo-subtle uppercase tracking-wide">Theme</label>
                <div className="px-3 py-2 bg-kumo-control border border-kumo-line rounded-md text-sm text-kumo-subtle">
                  Dark (default)
                </div>
                <p className="text-[11px] text-kumo-subtle">Additional themes coming in a future release.</p>
              </div>
            </div>
          )}

          {activeTab === 'quick-actions' && (
            <QuickActionsTab
              quickActions={settings.quickActions}
              onChange={(quickActions) => updateSettings({ quickActions })}
              inputClasses={inputClasses}
              commands={commands}
            />
          )}

          {activeTab === 'shortcuts' && (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-kumo-subtle mb-1">
                Keyboard shortcuts are not editable in this version.
              </p>
              <div className="border border-kumo-line rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-kumo-control text-kumo-subtle text-[11px] uppercase tracking-wider">
                      <th className="text-left px-3 py-2 font-medium">Key</th>
                      <th className="text-left px-3 py-2 font-medium">Action</th>
                      <th className="text-left px-3 py-2 font-medium">Scope</th>
                    </tr>
                  </thead>
                  <tbody>
                    {KEYBOARD_SHORTCUTS.map((shortcut, index) => (
                      <tr
                        key={shortcut.key}
                        className={index % 2 === 0 ? 'bg-kumo-elevated' : 'bg-kumo-control/30'}
                      >
                        <td className="px-3 py-2">
                          <kbd className="px-1.5 py-0.5 bg-kumo-fill border border-kumo-line rounded text-[11px] font-mono text-kumo-strong">
                            {shortcut.key}
                          </kbd>
                        </td>
                        <td className="px-3 py-2 text-kumo-default">{shortcut.action}</td>
                        <td className="px-3 py-2">
                          <span className="text-[10px] font-medium uppercase tracking-wider text-kumo-subtle">
                            {shortcut.scope}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'about' && (
            <div className="flex flex-col items-center gap-4 py-6">
              <div className="w-14 h-14 rounded-2xl bg-kumo-brand/20 flex items-center justify-center">
                <GearSix size={28} className="text-kumo-brand" />
              </div>
              <div className="text-center">
                <h3 className="text-lg font-semibold text-kumo-strong">OC Orchestrator</h3>
                <p className="text-sm text-kumo-subtle mt-1">Version {appVersion || '...'}</p>
              </div>
              <p className="text-xs text-kumo-subtle text-center max-w-xs">
                Supervise concurrent coding agents from a single dashboard.
              </p>
              <div className="flex flex-col gap-2 mt-2">
                <a
                  href="#"
                  onClick={(event) => event.preventDefault()}
                  className="text-xs text-kumo-link hover:underline"
                >
                  Documentation
                </a>
                <a
                  href="#"
                  onClick={(event) => event.preventDefault()}
                  className="text-xs text-kumo-link hover:underline"
                >
                  Release Notes
                </a>
                <a
                  href="#"
                  onClick={(event) => event.preventDefault()}
                  className="text-xs text-kumo-link hover:underline"
                >
                  Report an Issue
                </a>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-5 py-3 border-t border-kumo-line">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-kumo-subtle border border-kumo-line rounded-md hover:bg-kumo-fill transition-colors"
          >
             Save
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Quick Actions Tab ──

function QuickActionsTab({
  quickActions,
  onChange,
  inputClasses,
  commands = [],
}: {
  quickActions: QuickActionSlots
  onChange: (actions: QuickActionSlots) => void
  inputClasses: string
  commands?: ChatCommandOption[]
}) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)
  const [autoFocusIndex, setAutoFocusIndex] = useState<number | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<number | null>(null)
  const labelInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocusIndex !== null && expandedIndex === autoFocusIndex && labelInputRef.current) {
      labelInputRef.current.focus()
      labelInputRef.current.select()
      setAutoFocusIndex(null)
    }
  }, [autoFocusIndex, expandedIndex])

  const addActionAtSlot = (index: number) => {
    const newAction: QuickAction = {
      id: `qa-${Date.now()}`,
      label: 'New Action',
      icon: 'lightning',
      prompt: '',
    }
    const updated = [...quickActions]
    updated[index] = newAction
    onChange(updated)
    setExpandedIndex(index)
    setAutoFocusIndex(index)
  }

  const updateAction = (index: number, partial: Partial<QuickAction>) => {
    const qa = quickActions[index]
    if (!qa) return
    const updated = [...quickActions]
    updated[index] = { ...qa, ...partial }
    onChange(updated)
  }

  const removeAction = (index: number) => {
    const updated = [...quickActions]
    updated[index] = null
    onChange(updated)
    if (expandedIndex === index) setExpandedIndex(null)
  }

  const swapSlots = (from: number, to: number) => {
    if (from === to) return
    const updated = [...quickActions]
    updated[from] = quickActions[to]
    updated[to] = quickActions[from]
    onChange(updated)
    if (expandedIndex === from) setExpandedIndex(to)
    else if (expandedIndex === to) setExpandedIndex(from)
  }

  const resetDrag = () => {
    setDragIndex(null)
    setDropTarget(null)
  }

  const dragPropsFor = (index: number) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      setDragIndex(index)
      setExpandedIndex(null)
      e.dataTransfer.effectAllowed = 'move' as const
      e.dataTransfer.setData('text/plain', String(index))
    },
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move' as const
      if (dragIndex !== null && dragIndex !== index) {
        setDropTarget(index)
      }
    },
    onDragLeave: () => setDropTarget(null),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      if (dragIndex !== null) swapSlots(dragIndex, index)
      resetDrag()
    },
    onDragEnd: resetDrag,
  })

  const dragHandleClasses = 'cursor-grab active:cursor-grabbing text-kumo-subtle/40 hover:text-kumo-subtle transition-colors shrink-0'

  const slotBorderClass = (index: number, isValid: boolean): string => {
    if (dropTarget === index && dragIndex !== index) return 'border-kumo-brand ring-1 ring-kumo-brand/30'
    if (dragIndex === index) return 'opacity-40 border-kumo-line'
    if (!isValid) return 'border-kumo-danger/30'
    return 'border-kumo-line'
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-xs text-kumo-subtle">
          Quick action buttons appear in the agent drawer&apos;s action rail. Each sends a prompt to the agent when clicked. You can have up to {MAX_QUICK_ACTIONS}.
        </p>
        <p className="text-[11px] text-kumo-subtle mt-1">
          Tip: start a prompt with <code className="px-1 py-0.5 rounded bg-kumo-fill text-kumo-default">/command-name</code> to run an OpenCode slash command.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {quickActions.map((qa, index) => {
          if (!qa) {
            return (
              <div
                key={`slot-${index}`}
                {...dragPropsFor(index)}
                className={`flex items-center gap-2 rounded-lg border border-dashed transition-all ${slotBorderClass(index, true)}`}
              >
                <div className={`pl-2.5 py-2.5 ${dragHandleClasses}`}>
                  <DotsSixVertical size={14} />
                </div>
                <button
                  type="button"
                  onClick={() => addActionAtSlot(index)}
                  className="flex items-center gap-1.5 flex-1 py-2.5 pr-3 text-xs font-medium text-kumo-subtle hover:text-kumo-default transition-colors"
                >
                  <Plus size={12} />
                  Slot {index + 1} — Add Quick Action
                </button>
              </div>
            )
          }

          const isExpanded = expandedIndex === index
          const IconComp = getIconComponent(qa.icon)
          const isValid = isQuickActionValid(qa)

          return (
            <div
              key={qa.id}
              {...dragPropsFor(index)}
              className={`border rounded-lg overflow-hidden bg-kumo-control/30 transition-all ${slotBorderClass(index, isValid)}`}
            >
              {/* Header with drag handle + expand toggle + remove */}
              <div className="flex items-center gap-1.5 px-2 py-2.5 hover:bg-kumo-fill/50 transition-colors">
                <div className={dragHandleClasses}>
                  <DotsSixVertical size={14} />
                </div>
                <span className="text-[10px] text-kumo-subtle font-mono shrink-0 w-3">{index + 1}</span>
                <button
                  type="button"
                  onClick={() => setExpandedIndex(isExpanded ? null : index)}
                  className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
                >
                  <IconComp size={14} className="text-kumo-subtle shrink-0" />
                  <span className="text-sm font-medium text-kumo-default flex-1 truncate">{qa.label || 'Untitled'}</span>
                  {!isValid && (
                    <span className="text-[9px] text-kumo-danger font-medium shrink-0">Incomplete</span>
                  )}
                  <CaretDown
                    size={12}
                    className={`text-kumo-subtle transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => removeAction(index)}
                  className="w-6 h-6 flex items-center justify-center rounded-md text-kumo-subtle hover:text-kumo-danger hover:bg-kumo-danger/10 transition-colors shrink-0"
                  title="Remove"
                >
                  <Trash size={12} />
                </button>
              </div>

              {/* Expanded editor */}
              {isExpanded && (
                <div className="px-3 pb-3 flex flex-col gap-3 border-t border-kumo-line pt-3">
                  <div className="flex gap-2">
                    <div className="flex-1 flex flex-col gap-1">
                      <label className="text-[11px] font-medium text-kumo-subtle uppercase tracking-wide">
                        Button Label
                      </label>
                      <input
                        ref={autoFocusIndex === index ? labelInputRef : undefined}
                        type="text"
                        value={qa.label}
                        onChange={(e) => updateAction(index, { label: e.target.value })}
                        maxLength={20}
                        placeholder="e.g. Create PR, Run Tests"
                        className={inputClasses}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-medium text-kumo-subtle uppercase tracking-wide">
                        Icon
                      </label>
                      <div className="flex gap-1">
                        {ICON_OPTIONS.map((opt) => {
                          const OptIcon = opt.icon
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => updateAction(index, { icon: opt.value })}
                              title={opt.label}
                              className={`w-7 h-7 flex items-center justify-center rounded-md border transition-colors ${
                                qa.icon === opt.value
                                  ? 'border-kumo-brand bg-kumo-brand/10 text-kumo-brand'
                                  : 'border-kumo-line text-kumo-subtle hover:text-kumo-default hover:bg-kumo-fill'
                              }`}
                            >
                              <OptIcon size={13} />
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>

                  <PromptTextarea
                    value={qa.prompt}
                    onChange={(v) => updateAction(index, { prompt: v })}
                    commands={commands}
                    inputClasses={inputClasses}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Prompt textarea with slash command autocomplete ──

function PromptTextarea({
  value,
  onChange,
  commands,
  inputClasses,
}: {
  value: string
  onChange: (value: string) => void
  commands: ChatCommandOption[]
  inputClasses: string
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [showAutocomplete, setShowAutocomplete] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Show autocomplete when the full value starts with "/" and there's no space yet (single-token command)
  const trimmed = value.trim().toLowerCase()
  const isTypingCommand = value.startsWith('/') && !value.includes(' ') && !value.includes('\n')
  const matchingCommands = isTypingCommand
    ? commands.filter((c) => c.command.startsWith(trimmed))
    : []
  const shouldShow = showAutocomplete && matchingCommands.length > 0 && !commands.some((c) => c.command === trimmed)

  const insertCommand = (command: string) => {
    onChange(`${command} `)
    setShowAutocomplete(false)
    setSelectedIndex(0)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!shouldShow) return
    if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
      e.preventDefault()
      const selected = matchingCommands[selectedIndex]
      if (selected) insertCommand(selected.command)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev + 1) % matchingCommands.length)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev - 1 + matchingCommands.length) % matchingCommands.length)
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setShowAutocomplete(false)
      return
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-medium text-kumo-subtle uppercase tracking-wide">
        Prompt
      </label>
      <div className="relative">
        {shouldShow && (
          <div className="absolute bottom-full left-0 right-0 z-20 mb-1 rounded-lg border border-kumo-line bg-kumo-overlay p-1 shadow-xl max-h-40 overflow-y-auto">
            {matchingCommands.map((cmd, index) => (
              <button
                key={cmd.command}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  insertCommand(cmd.command)
                }}
                className={`flex w-full items-start gap-3 rounded-md px-2.5 py-2 text-left transition-colors ${
                  index === selectedIndex ? 'bg-kumo-fill' : 'hover:bg-kumo-fill'
                }`}
              >
                <span className="font-mono text-[11px] text-kumo-default">{cmd.command}</span>
                <span className="text-[11px] text-kumo-subtle truncate">{cmd.description}</span>
              </button>
            ))}
            <div className="px-2.5 py-1 text-[10px] text-kumo-subtle border-t border-kumo-line mt-1 pt-1">
              Tab/Enter to select · Arrow keys to navigate
            </div>
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            setShowAutocomplete(true)
            setSelectedIndex(0)
          }}
          onKeyDown={handleKeyDown}
          onBlur={() => setTimeout(() => setShowAutocomplete(false), 150)}
          onFocus={() => setShowAutocomplete(true)}
          placeholder="The message sent to the agent when this button is clicked... Type / for commands."
          rows={6}
          className={`${inputClasses} min-h-24 resize-y leading-6`}
        />
      </div>
    </div>
  )
}
