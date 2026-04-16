import { useState, useMemo, useCallback, useEffect } from 'react'
import { TopBar } from './components/TopBar'
import { InterruptBanner } from './components/InterruptBanner'
import { FilterBar, matchesFilter, EMPTY_FILTER, cycleFilter, loadPersistedFilter, persistFilter, loadPersistedSearch, persistSearch, type FilterState, type StatusFilter } from './components/FilterBar'
import { FleetTable } from './components/FleetTable'
import { StatusBar } from './components/StatusBar'
import { DetailDrawer, type ChatCommand } from './components/DetailDrawer'
import { LaunchModal, type FreshWorktreeConfig, type ImportSessionConfig } from './components/LaunchModal'
import { SessionBrowser } from './components/SessionBrowser'
import { SettingsModal } from './components/SettingsModal'
import { CommandPalette } from './components/CommandPalette'
import { ModelPickerModal } from './components/ModelPickerModal'
import { McpModal } from './components/McpModal'
import { useAgentStore, setViewedAgentId, type LiveAgent } from './hooks/useAgentStore'
import { useCustomLabels } from './hooks/useCustomLabels'
import { type AgentRuntime, type Interrupt, type Message, type ColumnKey, type ColumnWidths, type SortDirection, loadColumnVisibility, saveColumnVisibility, loadColumnWidths, saveColumnWidths, loadSort, saveSort, compareStatusPriority } from './types'
import type { FileChange } from './components/FilesChanged'
import type { ToolCall } from './components/ToolsUsage'
import type { EventEntry } from './components/EventLog'
import { loadSettings } from './data/settings'

const NEW_AGENT_COMMAND = '/new'
const AGENT_MENTION_REGEX = /@(\w+)/

function sanitizeSlugSegment(value: string, fallback: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)

  return sanitized || fallback
}

function mapToolState(toolState?: string): ToolCall['state'] {
  if (toolState === 'completed') return 'completed'
  if (toolState === 'error' || toolState === 'failed') return 'failed'
  return 'running'
}

function extractLastAssistantMessage(messages: { role: string; parts: { type: string; text?: string }[] }[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== 'assistant') continue
    const text = messages[i].parts
      .filter((p) => p.type === 'text' && p.text)
      .map((p) => p.text!)
      .join(' ')
    if (text) return text.slice(0, 200)
  }
  return undefined
}

export function App() {
  const [filter, setFilterRaw] = useState<FilterState>(loadPersistedFilter)
  const [searchQuery, setSearchQueryRaw] = useState(loadPersistedSearch)

  const setFilter = useCallback((value: FilterState | ((prev: FilterState) => FilterState)) => {
    setFilterRaw((prev) => {
      const next = typeof value === 'function' ? value(prev) : value
      persistFilter(next)
      return next
    })
  }, [])

  const setSearchQuery = useCallback((value: string) => {
    setSearchQueryRaw(value)
    persistSearch(value)
  }, [])

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [showLaunchModal, setShowLaunchModal] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [showSessionBrowser, setShowSessionBrowser] = useState(false)

  const [sortColumn, setSortColumnRaw] = useState<ColumnKey | null>(() => loadSort().column)
  const [sortDirection, setSortDirectionRaw] = useState<SortDirection>(() => loadSort().direction)
  const [tick, setTick] = useState(0)
  const [agentCommands, setAgentCommands] = useState<ChatCommand[]>([])
  const [agentConfigs, setAgentConfigs] = useState<Array<{ name: string; description?: string }>>([])
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [modelPickerAgentId, setModelPickerAgentId] = useState<string | null>(null)
  const [showMcpModal, setShowMcpModal] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<{ currentVersion: string; latestVersion: string } | null>(null)
  const [appVersion, setAppVersion] = useState('')
  const [dismissedInterruptIds, setDismissedInterruptIds] = useState<Set<string> | null>(null)
  const [launchCommands, setLaunchCommands] = useState<ChatCommand[]>([])
  const [launchAgentConfigs, setLaunchAgentConfigs] = useState<Array<{ name: string; description?: string }>>([])
  const [quickLaunching, setQuickLaunching] = useState(false)
  const [visibleColumns, setVisibleColumnsRaw] = useState<Set<ColumnKey>>(loadColumnVisibility)
  const [columnWidths, setColumnWidthsRaw] = useState<ColumnWidths>(loadColumnWidths)

  const setVisibleColumns = useCallback((value: Set<ColumnKey> | ((prev: Set<ColumnKey>) => Set<ColumnKey>)) => {
    setVisibleColumnsRaw((prev) => {
      const next = typeof value === 'function' ? value(prev) : value
      saveColumnVisibility(next)
      return next
    })
  }, [])

  const handleColumnResize = useCallback((key: ColumnKey, width: number) => {
    setColumnWidthsRaw((prev) => {
      const next = { ...prev, [key]: width }
      saveColumnWidths(next)
      return next
    })
  }, [])

  const handleColumnResetWidth = useCallback((key: ColumnKey) => {
    setColumnWidthsRaw((prev) => {
      const next = { ...prev }
      delete next[key]
      saveColumnWidths(next)
      return next
    })
  }, [])

  const store = useAgentStore()
  const { allLabels, createLabel, deleteLabel } = useCustomLabels()

  // Destructure stable callbacks (all use useCallback(fn, [])) to avoid
  // depending on the whole `store` object in downstream hooks.
  const {
    listCommands,
    listAgentConfigs,
    getMessagesForSession,
    getFileChangesForSession,
    getEventsForSession,
    sendMessage: storeSendMessage,
    replyToQuestion: storeReplyToQuestion,
    resetSession: storeResetSession,
    respondToPermission: storeRespondToPermission,
    rejectQuestion: storeRejectQuestion,
    abortAgent: storeAbortAgent,
    removeAgent: storeRemoveAgent,
    setAgentModel: storeSetAgentModel,
    executeCommand: storeExecuteCommand,
    toggleLabel: storeToggleLabel,
    clearLabels: storeClearLabels,
    replaceLabel: storeReplaceLabel,
    renameAgent: storeRenameAgent,
    setPrUrl: storeSetPrUrl
  } = store

  useEffect(() => {
    if (!selectedAgentId) {
      setAgentCommands([])
      setAgentConfigs([])
      return
    }

    let cancelled = false

    const fetchCommands = async (): Promise<void> => {
      const commands = await listCommands(selectedAgentId)
      if (cancelled) return

      const builtInCommands: ChatCommand[] = [
        { command: '/new', description: 'Reset conversation — start a fresh session with clean context' },
        { command: '/model', description: 'Open model picker or set model — /model [provider/model-id]' },
        { command: '/compact', description: 'Compact conversation to reduce context usage' },
        { command: '/share', description: 'Share this session' },
        { command: '/mcp', description: 'Open MCP server manager' },
        { command: '/sessions', description: 'Browse and resume existing sessions from a project' }
      ]

      if (commands && Array.isArray(commands)) {
        for (const cmd of commands) {
          if (builtInCommands.some((local) => local.command === `/${cmd.name}`)) continue
          builtInCommands.push({
            command: `/${cmd.name}`,
            description: cmd.description || cmd.template || cmd.name
          })
        }
      }

      setAgentCommands(builtInCommands)
    }

    const fetchAgentConfigs = async (): Promise<void> => {
      const configs = await listAgentConfigs(selectedAgentId)
      if (cancelled) return
      setAgentConfigs(configs ?? [])
    }

    void fetchCommands()
    void fetchAgentConfigs()

    return () => { cancelled = true }
  }, [selectedAgentId, listCommands, listAgentConfigs])

  // ── Fetch commands & agent configs for the launch modal from any available runtime ──
  useEffect(() => {
    if (!showLaunchModal) {
      setLaunchCommands([])
      setLaunchAgentConfigs([])
      return
    }

    let cancelled = false

    const fetchLaunchData = async (): Promise<void> => {
      // Only custom runtime commands are shown — built-in drawer commands
      // (/new, /model, /compact, etc.) don't apply at launch time.
      try {
        const cmdResult = await window.api.listAllCommands()
        if (cancelled) return
        const cmds = Array.isArray(cmdResult.data) ? cmdResult.data as Array<{ name: string; description?: string; template?: string }> : []
        setLaunchCommands(cmds.map((cmd) => ({
          command: `/${cmd.name}`,
          description: cmd.description || cmd.template || cmd.name
        })))
      } catch { /* no runtime available */ }

      try {
        const cfgResult = await window.api.listAllAgentConfigs()
        if (cancelled) return
        const configs = Array.isArray(cfgResult.data) ? cfgResult.data as Array<{ name: string; description?: string }> : []
        setLaunchAgentConfigs(configs)
      } catch { /* no runtime available */ }
    }

    void fetchLaunchData()

    return () => { cancelled = true }
  }, [showLaunchModal])

  // ── Live timestamp refresh (every 30s) ──
  useEffect(() => {
    const interval = setInterval(() => {
      setTick((prev) => prev + 1)
    }, 30_000)
    return () => clearInterval(interval)
  }, [])

  // ── Sync notification preferences to main process on startup ──
  useEffect(() => {
    const settings = loadSettings()
    for (const [key, enabled] of Object.entries(settings.notifications)) {
      window.api.setNotificationPreference(key as keyof typeof settings.notifications, enabled)
    }
    window.api.setSoundEnabled(settings.soundEnabled)
  }, [])

  // ── Suppress notifications for the agent whose transcript is open ──
  useEffect(() => {
    setViewedAgentId(selectedAgentId)
  }, [selectedAgentId])

  // ── Fetch app version ──
  useEffect(() => {
    window.api.getVersion().then((result) => {
      if (result.ok && result.data) setAppVersion(result.data)
    })
  }, [])

  // ── Update notification ──
  useEffect(() => {
    if (!window.api?.onUpdateAvailable) return
    return window.api.onUpdateAvailable((data) => setUpdateInfo(data))
  }, [])

  // ── Select agent when desktop notification is clicked ──
  // The detail drawer looks up agents from the unfiltered list, so we
  // only need to set the selection — no need to clear filters/search.

  // Push path: main process sends agentId directly via IPC
  useEffect(() => {
    if (!window.api?.onNotificationSelectAgent) return
    return window.api.onNotificationSelectAgent((data) => {
      console.log('[App] Notification select-agent received (push):', data.agentId)
      setSelectedAgentId(data.agentId)
    })
  }, [])

  // Pull path: when the window gains focus, check if there's a pending
  // notification click that the push path may have missed (e.g. the
  // renderer was throttled while the app was in the background on macOS).
  useEffect(() => {
    if (!window.api?.getPendingNotificationAgent) return

    const checkPending = async (): Promise<void> => {
      const result = await window.api.getPendingNotificationAgent()
      if (result.ok && result.data) {
        console.log('[App] Notification select-agent received (pull on focus):', result.data)
        setSelectedAgentId(result.data)
      }
    }

    window.addEventListener('focus', checkPending)
    return () => window.removeEventListener('focus', checkPending)
  }, [])

  // ── Convert live agents to AgentRuntime shape ──
  const liveAgentsAsRuntimes: AgentRuntime[] = useMemo(() => {
    return store.agents.map((agent): AgentRuntime => {
      const lastMessage = extractLastAssistantMessage(getMessagesForSession(agent.sessionId))

      return {
        id: agent.id,
        name: agent.name,
        projectId: agent.directory,
        projectName: agent.projectName,
        branchName: agent.branchName,
        isWorktree: agent.isWorktree,
        workspaceName: agent.workspaceName,
        taskSummary: agent.taskSummary,
        status: agent.status,
        labelIds: agent.labelIds,
        model: agent.model,
        prUrl: agent.prUrl,
        lastActivityAt: formatTimeAgo(agent.lastActivityAt),
        lastActivityAtMs: agent.lastActivityAt,
        blockedSince: agent.blockedSince ? formatTimeAgo(agent.blockedSince) : undefined,
        blockedSinceMs: agent.blockedSince,
        lastMessage
      }
    })
  }, [store.agents, tick, getMessagesForSession])

  // ── Convert live permissions + needs_input agents to Interrupt shape ──
  const liveInterrupts: Interrupt[] = useMemo(() => {
    const permissionInterrupts = store.permissions.map((perm): Interrupt => {
      const agent = store.agents.find((agnt) => agnt.id === perm.agentId)
      return {
        id: perm.id,
        runtimeId: perm.agentId,
        agentName: agent?.name ?? 'unknown',
        projectName: agent?.projectName ?? 'unknown',
        kind: 'needs_approval',
        reason: perm.title,
        createdAt: formatTimeAgo(perm.createdAt)
      }
    })

    const questionInterrupts = store.questions.map((q): Interrupt => {
      const agent = store.agents.find((agnt) => agnt.id === q.agentId)
      const firstQuestion = q.questions[0]
      return {
        id: q.id,
        runtimeId: q.agentId,
        agentName: agent?.name ?? 'unknown',
        projectName: agent?.projectName ?? 'unknown',
        kind: 'needs_input',
        reason: firstQuestion?.header ?? firstQuestion?.question ?? 'Agent has a question',
        createdAt: formatTimeAgo(q.createdAt)
      }
    })

    // Only include generic needs_input interrupts for agents that don't have a structured question
    const agentsWithQuestions = new Set(store.questions.map((q) => q.agentId))
    const inputInterrupts = store.agents
      .filter((agent) => agent.status === 'needs_input' && !agentsWithQuestions.has(agent.id))
      .map((agent): Interrupt => ({
        id: `input-${agent.id}`,
        runtimeId: agent.id,
        agentName: agent.name,
        projectName: agent.projectName,
        kind: 'needs_input',
        reason: 'Agent is waiting for your response',
        createdAt: formatTimeAgo(agent.blockedSince ?? agent.lastActivityAt)
      }))

    return [...permissionInterrupts, ...questionInterrupts, ...inputInterrupts]
  }, [store.permissions, store.questions, store.agents, tick])

  // ── Display data: always live (no mock fallback) ──
  const displayAgents = liveAgentsAsRuntimes
  const displayInterrupts = liveInterrupts

  // Re-show banner if new interrupts appear that weren't in the dismissed set
  const isBannerDismissed = dismissedInterruptIds !== null &&
    liveInterrupts.length > 0 &&
    liveInterrupts.every((interrupt) => dismissedInterruptIds.has(interrupt.id))

  const showInterruptBanner = displayInterrupts.length > 0 && !isBannerDismissed

  // ── Filtered + sorted agents ──
  const filteredAgents = useMemo(() => {
    let agents = displayAgents

    agents = agents.filter((agent) => matchesFilter(agent, filter))

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      agents = agents.filter(
        (agent) =>
          agent.name.toLowerCase().includes(query) ||
          agent.projectName.toLowerCase().includes(query) ||
          agent.taskSummary.toLowerCase().includes(query) ||
          agent.branchName.toLowerCase().includes(query) ||
          (agent.lastMessage ?? '').toLowerCase().includes(query)
      )
    }

    // Sort: urgent first as default, then apply column sort
    agents = [...agents].sort((left, right) => {
      const leftUrgent = left.status === 'needs_input' || left.status === 'needs_approval'
      const rightUrgent = right.status === 'needs_input' || right.status === 'needs_approval'
      if (leftUrgent && !rightUrgent) return -1
      if (!leftUrgent && rightUrgent) return 1

      // Apply column sort if set
      if (sortColumn) {
        let leftVal = ''
        let rightVal = ''

        switch (sortColumn) {
          case 'agent':
            leftVal = left.name.toLowerCase()
            rightVal = right.name.toLowerCase()
            break
          case 'status':
            leftVal = left.status
            rightVal = right.status
            break
          case 'task':
            leftVal = (left.taskSummary || '').toLowerCase()
            rightVal = (right.taskSummary || '').toLowerCase()
            break
          case 'branch':
            leftVal = (left.branchName || '').toLowerCase()
            rightVal = (right.branchName || '').toLowerCase()
            break
          case 'model':
            leftVal = (left.model || '').toLowerCase()
            rightVal = (right.model || '').toLowerCase()
            break
          case 'lastMessage':
            leftVal = (left.lastMessage || '').toLowerCase()
            rightVal = (right.lastMessage || '').toLowerCase()
            break
          case 'label':
            leftVal = left.labelIds.join(',').toLowerCase()
            rightVal = right.labelIds.join(',').toLowerCase()
            break
        }

        if (leftVal < rightVal) return sortDirection === 'asc' ? -1 : 1
        if (leftVal > rightVal) return sortDirection === 'asc' ? 1 : -1
      }

      // Tie-breaker: sort by status priority (running before idle, etc.)
      return compareStatusPriority(left.status, right.status)
    })

    return agents
  }, [displayAgents, filter, searchQuery, sortColumn, sortDirection])

  // Look up in displayAgents first (preferred — includes latest derived fields),
  // but fall back to the full unfiltered list so notification-driven navigation
  // always finds the agent even if a filter or search would otherwise hide it.
  const selectedAgent = useMemo(
    () =>
      displayAgents.find((agent) => agent.id === selectedAgentId)
      ?? liveAgentsAsRuntimes.find((agent) => agent.id === selectedAgentId)
      ?? null,
    [displayAgents, liveAgentsAsRuntimes, selectedAgentId]
  )

  // ── Messages for selected agent ──
  const selectedMessages: Message[] = useMemo(() => {
    if (!selectedAgent) return []

    const liveAgent = store.agents.find((agent) => agent.id === selectedAgent.id)
    if (!liveAgent) return []

    const liveMessages = getMessagesForSession(liveAgent.sessionId)
    const transcriptItems: Message[] = []
    let pendingToolCalls: ToolCall[] = []

    const flushPendingToolCalls = (anchorId: string, timestamp: number) => {
      if (pendingToolCalls.length === 0) return

      transcriptItems.push({
        id: `${anchorId}-tools`,
        role: 'tool-group',
        content: `${pendingToolCalls.length} tool call${pendingToolCalls.length === 1 ? '' : 's'}`,
        timestamp: formatTimeAgo(timestamp),
        toolCalls: pendingToolCalls
      })

      pendingToolCalls = []
    }

    for (const msg of liveMessages) {
      const textParts: string[] = []
      const toolCalls: ToolCall[] = []
      const images: Array<{ mime: string; url: string; filename?: string }> = []

      for (const part of msg.parts) {
        switch (part.type) {
          case 'text':
            if (part.text) {
              textParts.push(part.text)
            }
            break
          case 'tool':
            toolCalls.push({
              id: part.id,
              name: part.toolName ?? 'unknown',
              state: mapToolState(part.toolState),
              input: part.toolInput,
              output: part.text ?? undefined,
              timestamp: msg.createdAt
            })
            break
          case 'file':
            if (part.fileUrl && part.fileMime?.startsWith('image/')) {
              images.push({
                mime: part.fileMime!,
                url: part.fileUrl!,
                filename: part.fileName
              })
            }
            break
        }
      }

      const textContent = textParts.join('\n')

      if (textContent.trim() || images.length > 0) {
        flushPendingToolCalls(msg.id, msg.createdAt)

        transcriptItems.push({
          id: msg.id,
          role: msg.role,
          content: textContent,
          timestamp: formatTimeAgo(msg.createdAt),
          ...(images.length > 0 ? { images } : {})
        })
      }

      if (toolCalls.length > 0) {
        pendingToolCalls.push(...toolCalls)
      }

      if (!textContent.trim() && pendingToolCalls.length > 0 && msg === liveMessages[liveMessages.length - 1]) {
        flushPendingToolCalls(msg.id, msg.createdAt)
      }
    }

    if (liveMessages.length > 0) {
      const lastMessage = liveMessages[liveMessages.length - 1]
      flushPendingToolCalls(lastMessage.id, lastMessage.createdAt)
    }

    return transcriptItems
  }, [selectedAgent, store.agents, getMessagesForSession])

  // ── File changes for selected agent ──
  const selectedFiles: FileChange[] = useMemo(() => {
    if (!selectedAgent) return []
    const liveAgent = store.agents.find((agent) => agent.id === selectedAgent.id)
    if (!liveAgent) return []

    return getFileChangesForSession(liveAgent.sessionId)
  }, [selectedAgent, store.agents, getFileChangesForSession])

  // ── Extract tool calls from selectedMessages (derived, avoids redundant iteration) ──
  const selectedTools: ToolCall[] = useMemo(() => {
    const tools: ToolCall[] = []
    for (const msg of selectedMessages) {
      if (msg.role === 'tool-group' && msg.toolCalls) {
        tools.push(...msg.toolCalls)
      }
    }
    return tools
  }, [selectedMessages])

  // ── Events for selected agent ──
  const selectedEvents: EventEntry[] = useMemo(() => {
    if (!selectedAgent) return []
    const liveAgent = store.agents.find((agent) => agent.id === selectedAgent.id)
    if (!liveAgent) return []

    return getEventsForSession(liveAgent.sessionId)
  }, [selectedAgent, store.agents, getEventsForSession])

  // ── Permission for selected agent ──
  const selectedPermission = useMemo(() => {
    if (!selectedAgent) return null
    return store.permissions.find((perm) => perm.agentId === selectedAgent.id) ?? null
  }, [selectedAgent, store.permissions])

  // ── Question for selected agent ──
  const selectedQuestion = useMemo(() => {
    if (!selectedAgent) return null
    return store.questions.find((q) => q.agentId === selectedAgent.id) ?? null
  }, [selectedAgent, store.questions])

  // ── Counts ──
  const counts = useMemo(
    () => ({
      all: displayAgents.length,
      blocked: displayAgents.filter((agent) => agent.status === 'needs_input' || agent.status === 'needs_approval').length,
      running: displayAgents.filter((agent) => agent.status === 'running').length,
      idle: displayAgents.filter((agent) => agent.status === 'idle').length,
      errored: displayAgents.filter((agent) => agent.status === 'errored').length,
      completed: displayAgents.filter((agent) => agent.status === 'completed').length
    }),
    [displayAgents]
  )

  const labelCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const agent of displayAgents) {
      for (const id of agent.labelIds) {
        counts[id] = (counts[id] ?? 0) + 1
      }
    }
    return counts
  }, [displayAgents])

  const projectNames = useMemo(() => {
    const names = new Set(store.agents.map((agent) => agent.projectName))
    return Array.from(names)
  }, [store.agents])

  // ── Helper: find live agent by id ──
  const findLiveAgent = useCallback(
    (agentId: string): LiveAgent | undefined => {
      return store.agents.find((agent) => agent.id === agentId)
    },
    [store.agents]
  )

  // ── Helper: find permission for agent ──
  const findPermissionForAgent = useCallback(
    (agentId: string) => {
      return store.permissions.find((perm) => perm.agentId === agentId)
    },
    [store.permissions]
  )

  // ── Sort handler ──
  const handleSort = useCallback((column: string, direction: 'asc' | 'desc') => {
    const col = column as ColumnKey
    setSortColumnRaw(col)
    setSortDirectionRaw(direction)
    saveSort({ column: col, direction })
  }, [])

  // ── Row actions ──
  const handleRowApprove = useCallback(async (agentId: string) => {
    const permission = findPermissionForAgent(agentId)
    if (permission) {
      await storeRespondToPermission(agentId, permission.id, 'once')
    }
  }, [findPermissionForAgent, storeRespondToPermission])

  const handleRowReply = useCallback((agentId: string) => {
    setSelectedAgentId(agentId)
  }, [])

  const handleRowStop = useCallback(async (agentId: string) => {
    await storeAbortAgent(agentId)
  }, [storeAbortAgent])

  const handleRowOpen = useCallback((agentId: string) => {
    setSelectedAgentId(agentId)
  }, [])

  const handleToggleLabel = useCallback((agentId: string, labelId: string) => {
    storeToggleLabel(agentId, labelId)
  }, [storeToggleLabel])

  const handleClearLabels = useCallback((agentId: string) => {
    storeClearLabels(agentId)
  }, [storeClearLabels])

  const handleReplaceLabel = useCallback((agentId: string, oldLabelId: string, newLabelId: string) => {
    storeReplaceLabel(agentId, oldLabelId, newLabelId)
  }, [storeReplaceLabel])

  const handleDeleteLabel = useCallback(async (labelId: string): Promise<boolean> => {
    for (const agent of store.agents) {
      if (agent.labelIds.includes(labelId)) {
        storeToggleLabel(agent.id, labelId)
      }
    }
    return deleteLabel(labelId)
  }, [store.agents, storeToggleLabel, deleteLabel])

  const handleRemoveAgent = useCallback((agentId: string) => {
    const liveAgent = findLiveAgent(agentId)
    if (!liveAgent) return

    const confirmMessage = liveAgent.isWorktree
      ? `Remove ${liveAgent.name}? This will clean up the worktree and remove the agent from the UI.`
      : `Remove ${liveAgent.name} from the UI?`

    if (!window.confirm(confirmMessage)) return

    storeRemoveAgent(agentId)

    if (selectedAgentId === agentId) {
      setSelectedAgentId(null)
    }
  }, [findLiveAgent, selectedAgentId, storeRemoveAgent])

  // ── Built-in command handlers ──
  const handleBuiltInCommand = useCallback(async (agentId: string, commandName: string, commandArgs: string): Promise<boolean> => {
    switch (commandName) {
      case 'model': {
        if (!commandArgs) {
          setShowModelPicker(true)
          return true
        }
        // Direct model set: /model provider/model-id
        const updateResult = await window.api.updateConfig(agentId, { model: commandArgs })
        if (updateResult.ok) {
          storeSetAgentModel(agentId, commandArgs)
        } else {
          console.error('Failed to update model:', updateResult.error)
        }
        return true
      }

      case 'compact': {
        await window.api.compactSession(agentId)
        return true
      }

      case 'share': {
        const shareResult = await window.api.shareSession(agentId)
        if (shareResult.ok && shareResult.data) {
          const shareData = shareResult.data as { url?: string }
          if (shareData.url) {
            await window.api.openExternal(shareData.url)
          }
        }
        return true
      }

      case 'mcp': {
        setShowMcpModal(true)
        return true
      }

      case 'sessions': {
        setShowSessionBrowser(true)
        return true
      }

      default: {
        // Check if it's a custom command from the API (skills, /init, /review, etc.)
        const isKnownCommand = agentCommands.some((cmd) => cmd.command === `/${commandName}`)
        if (isKnownCommand) {
          await storeExecuteCommand(agentId, commandName, commandArgs)
          return true
        }
        return false
      }
    }
  }, [agentCommands, storeSetAgentModel, storeExecuteCommand])

  // ── Detail drawer actions ──
  const handleSendMessage = useCallback(async (text: string, attachments?: Array<{ mime: string; dataUrl: string; filename?: string }>) => {
    if (!selectedAgentId) return
    const trimmedText = text.trim()

    // If there's a single pending question that accepts custom input, route chat as a reply
    if (selectedQuestion && trimmedText && selectedQuestion.questions.length === 1) {
      const q = selectedQuestion.questions[0]
      if (q.custom !== false) {
        await storeReplyToQuestion(selectedAgentId, selectedQuestion.id, [[trimmedText]])
        return
      }
    }

    if (trimmedText === NEW_AGENT_COMMAND || trimmedText.startsWith(`${NEW_AGENT_COMMAND} `)) {
      const followUpPrompt = trimmedText.slice(NEW_AGENT_COMMAND.length).trim() || undefined
      await storeResetSession(selectedAgentId, followUpPrompt)
      return
    }

    // Check if input is a slash command (other than /new which is handled above)
    if (trimmedText.startsWith('/')) {
      const spaceIndex = trimmedText.indexOf(' ')
      const commandName = spaceIndex === -1 ? trimmedText.slice(1) : trimmedText.slice(1, spaceIndex)
      const commandArgs = spaceIndex === -1 ? '' : trimmedText.slice(spaceIndex + 1).trim()

      const handled = await handleBuiltInCommand(selectedAgentId, commandName, commandArgs)
      if (handled) return
    }

    // Check for @agentname mentions — extract agent name and strip from text
    const agentMatch = trimmedText.match(AGENT_MENTION_REGEX)
    if (agentMatch) {
      const mentionedAgent = agentMatch[1]
      const isKnownAgent = agentConfigs.some((cfg) => cfg.name === mentionedAgent)
      if (isKnownAgent) {
        const cleanText = trimmedText.replace(AGENT_MENTION_REGEX, '').trim()
        await storeSendMessage(selectedAgentId, cleanText || trimmedText, mentionedAgent, attachments)
        return
      }
    }

    await storeSendMessage(selectedAgentId, text, undefined, attachments)
  }, [agentConfigs, handleBuiltInCommand, selectedAgentId, selectedQuestion, storeSendMessage, storeReplyToQuestion, storeResetSession])

  const handleApprove = useCallback(async (permissionId: string) => {
    if (!selectedAgentId) return
    await storeRespondToPermission(selectedAgentId, permissionId, 'once')
  }, [selectedAgentId, storeRespondToPermission])

  const handleDeny = useCallback(async (permissionId: string) => {
    if (!selectedAgentId) return
    await storeRespondToPermission(selectedAgentId, permissionId, 'reject')
  }, [selectedAgentId, storeRespondToPermission])

  const handleReplyQuestion = useCallback(async (answers: string[][]) => {
    if (!selectedAgentId || !selectedQuestion) return
    await storeReplyToQuestion(selectedAgentId, selectedQuestion.id, answers)
  }, [selectedAgentId, selectedQuestion, storeReplyToQuestion])

  const handleRejectQuestion = useCallback(async () => {
    if (!selectedAgentId || !selectedQuestion) return
    await storeRejectQuestion(selectedAgentId, selectedQuestion.id)
  }, [selectedAgentId, selectedQuestion, storeRejectQuestion])

  const handleAbort = useCallback(async () => {
    if (!selectedAgentId) return
    await storeAbortAgent(selectedAgentId)
  }, [selectedAgentId, storeAbortAgent])

  const handleCloseDrawer = useCallback(() => setSelectedAgentId(null), [])

  const handleDrawerApprove = useCallback(() => {
    if (selectedPermission) handleApprove(selectedPermission.id)
  }, [selectedPermission, handleApprove])

  const handleDrawerDeny = useCallback(() => {
    if (selectedPermission) handleDeny(selectedPermission.id)
  }, [selectedPermission, handleDeny])

  const handleDrawerRemove = useCallback(() => {
    if (selectedAgentId) void handleRemoveAgent(selectedAgentId)
  }, [selectedAgentId, handleRemoveAgent])

  const handleDrawerChangeModel = useCallback(() => {
    setModelPickerAgentId(selectedAgentId)
    setShowModelPicker(true)
  }, [selectedAgentId])

  const handleDrawerToggleLabel = useCallback((labelId: string) => {
    if (selectedAgentId) handleToggleLabel(selectedAgentId, labelId)
  }, [selectedAgentId, handleToggleLabel])

  const handleDrawerClearLabels = useCallback(() => {
    if (selectedAgentId) handleClearLabels(selectedAgentId)
  }, [selectedAgentId, handleClearLabels])

  const handleDrawerSetPrUrl = useCallback((prUrl: string | null) => {
    if (selectedAgentId) storeSetPrUrl(selectedAgentId, prUrl)
  }, [selectedAgentId, storeSetPrUrl])

  const handleCreatePr = useCallback(async () => {
    if (!selectedAgentId) return
    await storeSendMessage(selectedAgentId, loadSettings().createPrPrompt, undefined, undefined, 'Create PR')
  }, [selectedAgentId, storeSendMessage])

  const handleOpenInEditor = useCallback(() => {
    if (!selectedAgentId) return
    const liveAgent = findLiveAgent(selectedAgentId)
    if (!liveAgent) return
    const settings = loadSettings()
    window.api.openInEditor({ path: liveAgent.directory, editor: settings.editor as 'vscode' | 'cursor' | 'windsurf' | 'goland' })
  }, [selectedAgentId, findLiveAgent])

  const handleOpenTerminalForDrawer = useCallback(() => {
    if (!selectedAgentId) return
    const liveAgent = findLiveAgent(selectedAgentId)
    if (!liveAgent) return
    const settings = loadSettings()
    window.api.openTerminal({ path: liveAgent.directory, terminal: settings.terminal })
  }, [selectedAgentId, findLiveAgent])

  const handleCreatePrForAgent = useCallback(async (agentId: string) => {
    await store.sendMessage(agentId, loadSettings().createPrPrompt, undefined, undefined, 'Create PR')
  }, [store])

  const handleOpenTerminal = useCallback((agentId: string) => {
    const liveAgent = findLiveAgent(agentId)
    if (!liveAgent) return
    const settings = loadSettings()
    window.api.openTerminal({ path: liveAgent.directory, terminal: settings.terminal })
  }, [findLiveAgent])

  const handleOpenInEditorForAgent = useCallback((agentId: string) => {
    const liveAgent = findLiveAgent(agentId)
    if (!liveAgent) return
    const settings = loadSettings()
    window.api.openInEditor({ path: liveAgent.directory, editor: settings.editor as 'vscode' | 'cursor' | 'windsurf' | 'goland' })
  }, [findLiveAgent])

  // ── Launch modal actions ──
  const handleLaunch = useCallback(async (
    directory: string,
    prompt?: string,
    title?: string,
    model?: string,
    worktreeStrategy?: string,
    attachments?: Array<{ mime: string; dataUrl: string; filename?: string }>,
    freshWorktreeConfig?: FreshWorktreeConfig,
    importSession?: ImportSessionConfig,
    labelIds?: string[]
  ) => {
    let launchDirectory = directory

    if (worktreeStrategy === 'new-worktree') {
      const repoRootResult = await window.api.getRepoRoot(directory)
      if (!repoRootResult.ok || !repoRootResult.data) {
        throw new Error(repoRootResult.error || 'Failed to resolve repo root')
      }

      const directoryParts = directory.replace(/\/$/, '').split('/').filter(Boolean)
      const projectSlug = sanitizeSlugSegment(directoryParts[directoryParts.length - 1] ?? 'project', 'project')
      const taskSource = title?.trim() || prompt?.trim() || (importSession ? importSession.sessionTitle : 'agent')
      const taskSlug = sanitizeSlugSegment(taskSource, 'agent')

      const worktreeResult = freshWorktreeConfig?.enabled
        ? await window.api.createFreshWorktree({
            repoRoot: repoRootResult.data,
            projectSlug,
            taskSlug,
            baseRef: freshWorktreeConfig.baseBranch || undefined
          })
        : await window.api.createWorktree({
            repoRoot: repoRootResult.data,
            projectSlug,
            taskSlug
          })

      if (!worktreeResult.ok || !worktreeResult.data) {
        throw new Error(worktreeResult.error || 'Failed to create worktree')
      }

      launchDirectory = worktreeResult.data.worktreePath
    }

    // If importing a session, fork it into the new directory and resume
    if (importSession) {
      const forkResult = await window.api.forkSession({
        sourceSessionId: importSession.sessionId,
        targetDirectory: launchDirectory
      })

      if (!forkResult.ok || !forkResult.data) {
        throw new Error(forkResult.error || 'Failed to fork session')
      }

      const resumeResult = await window.api.resumeAgent({
        directory: launchDirectory,
        sessionId: forkResult.data.sessionId,
        title: title || forkResult.data.title
      })

      if (!resumeResult?.ok) {
        throw new Error('Failed to resume forked session')
      }

      if (!resumeResult.data) return

      const agentId = (resumeResult.data as { id: string }).id
      setSelectedAgentId(agentId)

      if (labelIds?.length) {
        for (const labelId of labelIds) store.toggleLabel(agentId, labelId)
      }

      if (model && model !== 'auto') {
        store.setAgentModel(agentId, model)
        try { await window.api.updateConfig(agentId, { model }) }
        catch { /* best-effort */ }
      }

      if (prompt?.trim()) {
        try { await store.sendMessage(agentId, prompt.trim(), undefined, attachments) }
        catch (error) { console.error('[App] Post-fork prompt failed:', error) }
      }

      return
    }

    // Detect leading @agent mentions and /commands in the prompt.
    // Only leading tokens are treated as special syntax to avoid
    // false positives from @mentions mid-sentence.
    const trimmedPrompt = prompt?.trim() ?? ''
    const isSlashCommand = trimmedPrompt.startsWith('/')
    const leadingAgentMatch = trimmedPrompt.match(/^@(\w+)(?:\s|$)/)
    const needsPostLaunchHandling = isSlashCommand || !!leadingAgentMatch

    // If the prompt needs special handling, launch without it — the
    // runtime must exist before we can route commands or agent mentions.
    const launchPrompt = needsPostLaunchHandling ? undefined : (prompt || undefined)
    const result = await store.launchAgent(launchDirectory, launchPrompt, title, model, attachments)

    if (!result?.ok) {
      throw new Error('Failed to launch agent')
    }

    if (!result.data) return

    const agentId = (result.data as { id: string }).id
    setSelectedAgentId(agentId)

    if (labelIds?.length) {
      for (const labelId of labelIds) store.toggleLabel(agentId, labelId)
    }

    if (model && model !== 'auto') {
      store.setAgentModel(agentId, model)
    }

    if (!needsPostLaunchHandling || !trimmedPrompt) return

    // Handle @agent mentions and /commands that were deferred from launch.
    // Only custom runtime commands apply — built-in drawer commands
    // (/new, /compact, /share, etc.) don't apply at launch time.
    // Wrapped in try/catch so a failure here doesn't make the already-
    // successful launch appear failed (which would keep the modal open).
    try {
      if (isSlashCommand) {
        const spaceIndex = trimmedPrompt.indexOf(' ')
        const commandName = spaceIndex === -1 ? trimmedPrompt.slice(1) : trimmedPrompt.slice(1, spaceIndex)
        const commandArgs = spaceIndex === -1 ? '' : trimmedPrompt.slice(spaceIndex + 1).trim()

        const runtimeCommands = await store.listCommands(agentId)
        const isCustomCommand = runtimeCommands?.some((cmd: { name: string }) => cmd.name === commandName)
        if (isCustomCommand) {
          await store.executeCommand(agentId, commandName, commandArgs)
        } else {
          await store.sendMessage(agentId, trimmedPrompt, undefined, attachments)
        }
      } else if (leadingAgentMatch) {
        const mentionedAgent = leadingAgentMatch[1]
        const configs = await store.listAgentConfigs(agentId)
        const isKnownAgent = configs?.some((cfg: { name: string }) => cfg.name === mentionedAgent)
        if (isKnownAgent) {
          const cleanText = trimmedPrompt.slice(leadingAgentMatch[0].length).trim()
          await store.sendMessage(agentId, cleanText || trimmedPrompt, mentionedAgent, attachments)
        } else {
          await store.sendMessage(agentId, trimmedPrompt, undefined, attachments)
        }
      }
    } catch (error) {
      console.error('[App] Post-launch command/agent handling failed:', error)
    }
  }, [store])

  const handleQuickLaunch = useCallback(async () => {
    if (quickLaunching) return
    setQuickLaunching(true)
    try {
      const homeResult = await window.api.getHomeDirectory()
      if (!homeResult.ok || !homeResult.data) {
        console.error('[App] Failed to get home directory:', homeResult.error)
        return
      }

      const title = `QuickStart-${Math.random().toString(36).slice(2, 10)}`
      const result = await store.launchAgent(homeResult.data, undefined, title, 'auto')

      if (!result?.ok || !result.data) return

      const agentId = (result.data as { id: string }).id
      setSelectedAgentId(agentId)
    } catch (error) {
      console.error('[App] Quick launch failed:', error)
    } finally {
      setQuickLaunching(false)
    }
  }, [store, quickLaunching])

  const handleResumeSession = useCallback(async (directory: string, sessionId: string, title: string) => {
    const result = await window.api.resumeAgent({ directory, sessionId, title })
    if (!result?.ok) {
      throw new Error('Failed to resume session')
    }
    if (result.data) {
      const data = result.data as { id: string }
      setSelectedAgentId(data.id)
    }
  }, [])

  const handleValidateDirectory = useCallback(async (dir: string): Promise<boolean> => {
    if (!dir.trim() || dir.trim().length < 2) return false
    try {
      const result = await window.api.validateGitRepo(dir.trim())
      return result.ok && result.data === true
    } catch {
      // Fallback: accept any non-empty path starting with /
      return dir.startsWith('/')
    }
  }, [])

  // ── Keyboard navigation ──
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Don't intercept when typing in an input
      const target = event.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

      // Cmd+K -> command palette
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setShowCommandPalette((prev) => !prev)
        return
      }

      if (event.key === 'Escape') {
        if (showCommandPalette) {
          setShowCommandPalette(false)
          return
        }
        if (showSessionBrowser) {
          setShowSessionBrowser(false)
          return
        }
        if (showSettings) {
          setShowSettings(false)
          return
        }
        if (showLaunchModal) {
          setShowLaunchModal(false)
          return
        }
        if (selectedAgentId) {
          setSelectedAgentId(null)
          return
        }
        return
      }

      if (event.key === '/' && !event.metaKey && !event.ctrlKey) {
        event.preventDefault()
        const searchInput = document.querySelector<HTMLInputElement>('input[placeholder="Filter agents..."]')
        searchInput?.focus()
        return
      }

      // Q -> quick launch
      if (event.key === 'q' || event.key === 'Q') {
        if (!showLaunchModal && !showSettings && !showSessionBrowser) {
          void handleQuickLaunch()
        }
        return
      }

      // L -> open launch modal
      if (event.key === 'l' || event.key === 'L') {
        if (!showLaunchModal && !showSettings && !showSessionBrowser) {
          setShowLaunchModal(true)
        }
        return
      }

      // R -> open session browser (resume)
      if (event.key === 'r' || event.key === 'R') {
        if (!showLaunchModal && !showSettings && !showSessionBrowser) {
          setShowSessionBrowser(true)
        }
        return
      }

      // N -> jump to next urgent agent
      if (event.key === 'n' || event.key === 'N') {
        const urgentAgent = filteredAgents.find(
          (agent) => agent.status === 'needs_input' || agent.status === 'needs_approval'
        )
        if (urgentAgent) {
          setSelectedAgentId(urgentAgent.id)
        }
        return
      }

      // J/K -> navigate rows
      if (event.key === 'j' || event.key === 'k') {
        const currentIndex = filteredAgents.findIndex((agent) => agent.id === selectedAgentId)
        let nextIndex: number
        if (event.key === 'j') {
          nextIndex = currentIndex < filteredAgents.length - 1 ? currentIndex + 1 : 0
        } else {
          nextIndex = currentIndex > 0 ? currentIndex - 1 : filteredAgents.length - 1
        }
        setSelectedAgentId(filteredAgents[nextIndex]?.id ?? null)
        return
      }

      // Enter -> open selected agent detail
      if (event.key === 'Enter' && selectedAgentId) {
        // Already selected, this ensures the drawer opens
        setSelectedAgentId(selectedAgentId)
        return
      }

      // A -> approve selected agent's permission
      if (event.key === 'a' || event.key === 'A') {
        if (selectedAgentId) {
          const permission = findPermissionForAgent(selectedAgentId)
          if (permission) {
            store.respondToPermission(selectedAgentId, permission.id, 'once')
          }
        }
        return
      }

      // D -> deny selected agent's permission
      if (event.key === 'd' || event.key === 'D') {
        if (selectedAgentId) {
          const permission = findPermissionForAgent(selectedAgentId)
          if (permission) {
            store.respondToPermission(selectedAgentId, permission.id, 'reject')
          }
        }
        return
      }

      // S -> stop selected agent
      if (event.key === 's' || event.key === 'S') {
        if (selectedAgentId) {
          store.abortAgent(selectedAgentId)
        }
        return
      }
    },
    [filteredAgents, selectedAgentId, showLaunchModal, showSettings, showCommandPalette, showSessionBrowser, findPermissionForAgent, store, handleQuickLaunch]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <div className="flex flex-col h-full">
      <TopBar
        runningCount={counts.running}
        blockedCount={counts.blocked}
        idleCount={counts.idle}
        onLaunch={() => setShowLaunchModal(true)}
        onQuickLaunch={handleQuickLaunch}
        quickLaunching={quickLaunching}
        onOpenCommandPalette={() => setShowCommandPalette(true)}
        onSettings={() => setShowSettings(true)}
      />

      {updateInfo && (
        <div className="flex items-center justify-between px-4 py-1.5 bg-kumo-brand/10 border-b border-kumo-brand/20 text-xs text-kumo-brand shrink-0">
          <span>
            Update available: <strong>v{updateInfo.latestVersion}</strong> (current: v{updateInfo.currentVersion}).
            Run <code className="font-mono bg-kumo-fill px-1 py-0.5 rounded text-[10px]">npm update -g oc-orchestrator</code> to update.
          </span>
          <button
            type="button"
            onClick={() => setUpdateInfo(null)}
            className="text-kumo-subtle hover:text-kumo-default ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {showInterruptBanner && (
        <InterruptBanner
          interrupts={displayInterrupts}
          onReviewAll={() => setFilter((prev) => ({ ...prev, statuses: new Set<StatusFilter>(['blocked']), excludeStatuses: new Set() }))}
          onDismiss={() => setDismissedInterruptIds(new Set(displayInterrupts.map((i) => i.id)))}
        />
      )}

      <FilterBar
        filter={filter}
        onCycleStatus={(status) => {
          setFilter((prev) => {
            const { include, exclude } = cycleFilter(prev.statuses, prev.excludeStatuses, status)
            return { ...prev, statuses: include, excludeStatuses: exclude }
          })
        }}
        onCycleLabel={(label) => {
          setFilter((prev) => {
            const { include, exclude } = cycleFilter(prev.labels, prev.excludeLabels, label)
            return { ...prev, labels: include, excludeLabels: exclude }
          })
        }}
        onCycleProject={(project) => {
          setFilter((prev) => {
            const { include, exclude } = cycleFilter(prev.projects, prev.excludeProjects, project)
            return { ...prev, projects: include, excludeProjects: exclude }
          })
        }}
        onClearFilters={() => setFilter(EMPTY_FILTER)}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        counts={counts}
        labelCounts={labelCounts}
        allLabels={allLabels}
        projects={projectNames}
        visibleColumns={visibleColumns}
        onToggleColumn={(key) => {
          setVisibleColumns((prev) => {
            const next = new Set(prev)
            if (next.has(key)) {
              if (next.size > 1) next.delete(key)
            } else {
              next.add(key)
            }
            return next
          })
        }}
      />

      <FleetTable
        agents={filteredAgents}
        selectedId={selectedAgentId}
        onSelect={setSelectedAgentId}
        sortColumn={sortColumn}
        sortDirection={sortDirection}
        onSort={handleSort}
        onApprove={handleRowApprove}
        onReply={handleRowReply}
        onStop={handleRowStop}
        onOpen={handleRowOpen}
        onRemove={handleRemoveAgent}
        onRename={storeRenameAgent}
        onOpenTerminal={handleOpenTerminal}
        onOpenInEditor={handleOpenInEditorForAgent}
        onCreatePr={handleCreatePrForAgent}
        onSetPrUrl={storeSetPrUrl}
        onChangeModel={(agentId) => {
          setModelPickerAgentId(agentId)
          setShowModelPicker(true)
        }}
        onToggleLabel={handleToggleLabel}
        onClearLabels={handleClearLabels}
        onReplaceLabel={handleReplaceLabel}
        allLabels={allLabels}
        onCreateLabel={createLabel}
        onDeleteLabel={handleDeleteLabel}
        visibleColumns={visibleColumns}
        columnWidths={columnWidths}
        onColumnResize={handleColumnResize}
        onColumnResetWidth={handleColumnResetWidth}
      />

      <StatusBar
        agentCount={displayAgents.length}
        projectCount={projectNames.length}
        healthy={store.healthy}
        version={appVersion}
      />

      {selectedAgent && (
        <DetailDrawer
          agent={selectedAgent}
          messages={selectedMessages}
          permission={selectedPermission}
          question={selectedQuestion}
          files={selectedFiles}
          tools={selectedTools}
          events={selectedEvents}
          commands={agentCommands}
          agentConfigs={agentConfigs}
          onClose={handleCloseDrawer}
          onSendMessage={handleSendMessage}
          onApprove={selectedPermission ? handleDrawerApprove : undefined}
          onDeny={selectedPermission ? handleDrawerDeny : undefined}
          onReplyQuestion={selectedQuestion ? handleReplyQuestion : undefined}
          onRejectQuestion={selectedQuestion ? handleRejectQuestion : undefined}
          onAbort={handleAbort}
          onRemove={handleDrawerRemove}
           onCreatePr={handleCreatePr}
           onSetPrUrl={handleDrawerSetPrUrl}
           onOpenInEditor={handleOpenInEditor}
          onChangeModel={handleDrawerChangeModel}
          onOpenTerminal={handleOpenTerminalForDrawer}
          onToggleLabel={handleDrawerToggleLabel}
          onClearLabels={handleDrawerClearLabels}
          allLabels={allLabels}
          onCreateLabel={createLabel}
          onDeleteLabel={handleDeleteLabel}
        />
      )}

      {showLaunchModal && (
        <LaunchModal
          onClose={() => setShowLaunchModal(false)}
          onLaunch={handleLaunch}
          onSelectDirectory={store.selectDirectory}
          onValidateDirectory={handleValidateDirectory}
          knownDirectories={store.agents.map((a) => ({
            name: a.projectName,
            directory: a.directory,
            isWorktree: a.isWorktree
          }))}
          commands={launchCommands}
          agentConfigs={launchAgentConfigs}
          allLabels={allLabels}
          onCreateLabel={createLabel}
        />
      )}

      {showSessionBrowser && (
        <SessionBrowser
          onClose={() => setShowSessionBrowser(false)}
          onResume={handleResumeSession}
          onSelectDirectory={store.selectDirectory}
          onValidateDirectory={handleValidateDirectory}
          knownDirectories={store.agents.map((a) => ({
            name: a.projectName,
            directory: a.directory,
            isWorktree: a.isWorktree
          }))}
        />
      )}

      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}

      {showModelPicker && modelPickerAgentId && (
        <ModelPickerModal
          agentId={modelPickerAgentId}
          currentModel={displayAgents.find((a) => a.id === modelPickerAgentId)?.model
            ?? liveAgentsAsRuntimes.find((a) => a.id === modelPickerAgentId)?.model}
          onClose={() => { setShowModelPicker(false); setModelPickerAgentId(null) }}
          onSelect={async (modelPath) => {
            if (!modelPickerAgentId) return
            const result = await window.api.updateConfig(modelPickerAgentId, { model: modelPath })
            if (result.ok) {
              store.setAgentModel(modelPickerAgentId, modelPath)
              setShowModelPicker(false)
              setModelPickerAgentId(null)
            } else {
              console.error('Failed to set model:', result.error)
            }
          }}
        />
      )}

      {showMcpModal && selectedAgentId && (
        <McpModal
          agentId={selectedAgentId}
          onClose={() => setShowMcpModal(false)}
        />
      )}

      {showCommandPalette && (
        <CommandPalette
          agents={displayAgents.map((agent) => ({
            id: agent.id,
            name: agent.name,
            projectName: agent.projectName,
            status: agent.status
          }))}
          onClose={() => setShowCommandPalette(false)}
          onSelectAgent={(agentId) => {
            setSelectedAgentId(agentId)
            setShowCommandPalette(false)
          }}
          onLaunchAgent={() => {
            setShowCommandPalette(false)
            setShowLaunchModal(true)
          }}
          onResumeSession={() => {
            setShowCommandPalette(false)
            setShowSessionBrowser(true)
          }}
          onOpenSettings={() => {
            setShowCommandPalette(false)
            setShowSettings(true)
          }}
          onFilterChange={(updater) => {
            setFilter(updater)
            setShowCommandPalette(false)
          }}
          onStopAll={async () => {
            const running = store.agents.filter((liveAgent) => liveAgent.status === 'running' || liveAgent.status === 'needs_approval' || liveAgent.status === 'needs_input')
            await Promise.allSettled(running.map((liveAgent) => store.abortAgent(liveAgent.id)))
          }}
          onApproveAll={async () => {
            const blocked = store.agents.filter((liveAgent) => liveAgent.status === 'needs_approval')
            await Promise.allSettled(blocked.map((liveAgent) => {
              const permission = findPermissionForAgent(liveAgent.id)
              if (permission) return store.respondToPermission(liveAgent.id, permission.id, 'once')
              return Promise.resolve()
            }))
          }}
        />
      )}
    </div>
  )
}

function formatTimeAgo(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return 'just now'
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}
