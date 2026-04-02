import { useEffect, useState } from 'react'
import {
  X,
  GearSix,
  Keyboard,
  Info,
} from '@phosphor-icons/react'
import { SelectField } from './SelectField'
import {
  DEFAULT_CREATE_PR_PROMPT,
  loadSettings,
  saveSettings,
  type AppSettings,
  type NotificationPrefs,
} from '../data/settings'
import { useModelOptions } from '../hooks/useModelOptions'

const EDITOR_OPTIONS = [
  { value: 'vscode', label: 'VS Code' },
  { value: 'cursor', label: 'Cursor' },
  { value: 'windsurf', label: 'Windsurf' },
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

type TabId = 'general' | 'shortcuts' | 'about'

interface SettingsModalProps {
  onClose: () => void
}

const TAB_LIST: { id: TabId; label: string; icon: typeof GearSix }[] = [
  { id: 'general', label: 'General', icon: GearSix },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'about', label: 'About', icon: Info },
]

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>('general')
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

              {/* Notification Preferences */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium text-kumo-subtle uppercase tracking-wide">
                  Notification Preferences
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
