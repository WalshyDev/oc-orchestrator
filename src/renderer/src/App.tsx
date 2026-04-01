import { useState, useMemo, useCallback, useEffect } from 'react'
import { TopBar } from './components/TopBar'
import { InterruptBanner } from './components/InterruptBanner'
import { FilterBar, matchesFilter, type FilterValue } from './components/FilterBar'
import { FleetTable } from './components/FleetTable'
import { StatusBar } from './components/StatusBar'
import { DetailDrawer, type ChatCommand } from './components/DetailDrawer'
import { LaunchModal } from './components/LaunchModal'
import { SettingsModal } from './components/SettingsModal'
import { CommandPalette } from './components/CommandPalette'
import { ModelPickerModal } from './components/ModelPickerModal'
import { McpModal } from './components/McpModal'
import { useAgentStore, setViewedAgentId, type LiveAgent } from './hooks/useAgentStore'
import { type AgentRuntime, type Interrupt, type Message } from './types'
import type { FileChange } from './components/FilesChanged'
import type { ToolCall } from './components/ToolsUsage'
import type { EventEntry } from './components/EventLog'
import { loadSettings } from './data/settings'

type SortColumn = 'agent' | 'status' | 'task' | 'branch' | 'model' | 'activity'
type SortDirection = 'asc' | 'desc'

const NEW_AGENT_COMMAND = '/new'

function sanitizeSlugSegment(value: string, fallback: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  return sanitized || fallback
}

function mapToolState(toolState?: string): ToolCall['state'] {
  if (toolState === 'completed') return 'completed'
  if (toolState === 'error' || toolState === 'failed') return 'failed'
  return 'running'
}

export function App() {
  const [filter, setFilter] = useState<FilterValue>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [showLaunchModal, setShowLaunchModal] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)

  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null)
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [, setTick] = useState(0)
  const [agentCommands, setAgentCommands] = useState<ChatCommand[]>([])
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [showMcpModal, setShowMcpModal] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<{ currentVersion: string; latestVersion: string } | null>(null)

  const store = useAgentStore()

  // ── Fetch available commands when an agent is selected ──
  useEffect(() => {
    if (!selectedAgentId) {
      setAgentCommands([])
      return
    }

    let cancelled = false

    const fetchCommands = async (): Promise<void> => {
      const commands = await store.listCommands(selectedAgentId)
      if (cancelled) return

      const builtInCommands: ChatCommand[] = [
        { command: '/new', description: 'Reset conversation — start a fresh session with clean context' },
        { command: '/model', description: 'Open model picker or set model — /model [provider/model-id]' },
        { command: '/compact', description: 'Compact conversation to reduce context usage' },
        { command: '/share', description: 'Share this session' },
        { command: '/mcp', description: 'Open MCP server manager' }
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

    void fetchCommands()

    return () => { cancelled = true }
  }, [selectedAgentId, store])

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
  }, [])

  // ── Suppress notifications for the agent whose transcript is open ──
  useEffect(() => {
    setViewedAgentId(selectedAgentId)
  }, [selectedAgentId])

  // ── Update notification ──
  useEffect(() => {
    if (!window.api?.onUpdateAvailable) return
    return window.api.onUpdateAvailable((data) => setUpdateInfo(data))
  }, [])

  // ── Convert live agents to AgentRuntime shape ──
  const liveAgentsAsRuntimes: AgentRuntime[] = useMemo(() => {
    return store.agents.map((agent): AgentRuntime => ({
      id: agent.id,
      name: agent.name,
      projectId: agent.directory,
      projectName: agent.projectName,
      branchName: agent.branchName,
      isWorktree: agent.isWorktree,
      workspaceName: agent.workspaceName,
      taskSummary: agent.taskSummary,
      status: agent.status,
      model: agent.model,
      lastActivityAt: formatTimeAgo(agent.lastActivityAt),
      lastActivityAtMs: agent.lastActivityAt,
      blockedSince: agent.blockedSince ? formatTimeAgo(agent.blockedSince) : undefined,
      blockedSinceMs: agent.blockedSince
    }))
  }, [store.agents])

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

    const inputInterrupts = store.agents
      .filter((agent) => agent.status === 'needs_input')
      .map((agent): Interrupt => ({
        id: `input-${agent.id}`,
        runtimeId: agent.id,
        agentName: agent.name,
        projectName: agent.projectName,
        kind: 'needs_input',
        reason: 'Agent is waiting for your response',
        createdAt: formatTimeAgo(agent.blockedSince ?? agent.lastActivityAt)
      }))

    return [...permissionInterrupts, ...inputInterrupts]
  }, [store.permissions, store.agents])

  // ── Display data: always live (no mock fallback) ──
  const displayAgents = liveAgentsAsRuntimes
  const displayInterrupts = liveInterrupts

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
          agent.branchName.toLowerCase().includes(query)
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
          case 'activity':
            leftVal = left.lastActivityAt || ''
            rightVal = right.lastActivityAt || ''
            break
        }

        if (leftVal < rightVal) return sortDirection === 'asc' ? -1 : 1
        if (leftVal > rightVal) return sortDirection === 'asc' ? 1 : -1
      }

      return 0
    })

    return agents
  }, [displayAgents, filter, searchQuery, sortColumn, sortDirection])

  const selectedAgent = useMemo(
    () => displayAgents.find((agent) => agent.id === selectedAgentId) ?? null,
    [displayAgents, selectedAgentId]
  )

  // ── Messages for selected agent ──
  const selectedMessages: Message[] = useMemo(() => {
    if (!selectedAgent) return []

    const liveAgent = store.agents.find((agent) => agent.id === selectedAgent.id)
    if (!liveAgent) return []

    const liveMessages = store.getMessagesForSession(liveAgent.sessionId)
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
      const textContent = msg.parts
        .filter((part) => part.type === 'text' && part.text)
        .map((part) => part.text!)
        .join('\n')

      const toolCalls = msg.parts
        .filter((part) => part.type === 'tool')
        .map((part) => ({
          id: part.id,
          name: part.toolName ?? 'unknown',
          state: mapToolState(part.toolState),
          input: part.toolInput,
          output: part.text ?? undefined,
          timestamp: msg.createdAt
        }))

      if (textContent.trim()) {
        flushPendingToolCalls(msg.id, msg.createdAt)

        transcriptItems.push({
          id: msg.id,
          role: msg.role,
          content: textContent,
          timestamp: formatTimeAgo(msg.createdAt)
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
  }, [selectedAgent, store])

  // ── File changes for selected agent ──
  const selectedFiles: FileChange[] = useMemo(() => {
    if (!selectedAgent) return []
    const liveAgent = store.agents.find((agent) => agent.id === selectedAgent.id)
    if (!liveAgent) return []

    return store.getFileChangesForSession(liveAgent.sessionId)
  }, [selectedAgent, store])

  // ── Extract tool calls from store messages ──
  const selectedTools: ToolCall[] = useMemo(() => {
    if (!selectedAgent) return []
    const liveAgent = store.agents.find((agent) => agent.id === selectedAgent.id)
    if (!liveAgent) return []

    const liveMessages = store.getMessagesForSession(liveAgent.sessionId)
    const tools: ToolCall[] = []

    for (const msg of liveMessages) {
      for (const part of msg.parts) {
        if (part.type === 'tool') {
            tools.push({
              id: part.id,
              name: part.toolName ?? 'unknown',
              state: mapToolState(part.toolState),
              input: part.toolInput,
              output: part.text ?? undefined,
              timestamp: msg.createdAt
            })
          }
        }
      }

    return tools
  }, [selectedAgent, store])

  // ── Events for selected agent ──
  const selectedEvents: EventEntry[] = useMemo(() => {
    if (!selectedAgent) return []
    const liveAgent = store.agents.find((agent) => agent.id === selectedAgent.id)
    if (!liveAgent) return []

    return store.getEventsForSession(liveAgent.sessionId)
  }, [selectedAgent, store])

  // ── Permission for selected agent ──
  const selectedPermission = useMemo(() => {
    if (!selectedAgent) return null
    return store.permissions.find((perm) => perm.agentId === selectedAgent.id) ?? null
  }, [selectedAgent, store.permissions])

  // ── Counts ──
  const counts = useMemo(
    () => ({
      all: displayAgents.length,
      blocked: displayAgents.filter((agent) => agent.status === 'needs_input' || agent.status === 'needs_approval').length,
      running: displayAgents.filter((agent) => agent.status === 'running').length,
      idle: displayAgents.filter((agent) => agent.status === 'idle' || agent.status === 'completed').length
    }),
    [displayAgents]
  )

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
    setSortColumn(column as SortColumn)
    setSortDirection(direction)
  }, [])

  // ── Row actions ──
  const handleRowApprove = useCallback(async (agentId: string) => {
    const permission = findPermissionForAgent(agentId)
    if (permission) {
      await store.respondToPermission(agentId, permission.id, 'once')
    }
  }, [findPermissionForAgent, store])

  const handleRowReply = useCallback((agentId: string) => {
    setSelectedAgentId(agentId)
  }, [])

  const handleRowStop = useCallback(async (agentId: string) => {
    await store.abortAgent(agentId)
  }, [store])

  const handleRowOpen = useCallback((agentId: string) => {
    setSelectedAgentId(agentId)
  }, [])

  const handleRemoveAgent = useCallback(async (agentId: string) => {
    const liveAgent = findLiveAgent(agentId)
    if (!liveAgent) return

    const confirmMessage = liveAgent.isWorktree
      ? `Remove ${liveAgent.name}? This will clean up the worktree and remove the agent from the UI.`
      : `Remove ${liveAgent.name} from the UI?`

    if (!window.confirm(confirmMessage)) return

    const result = await store.removeAgent(agentId)
    if (!result?.ok) return


    if (selectedAgentId === agentId) {
      setSelectedAgentId(null)
    }
  }, [findLiveAgent, selectedAgentId, store])

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
        if (!updateResult.ok) {
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

      default: {
        // Check if it's a custom command from the API (skills, /init, /review, etc.)
        const isKnownCommand = agentCommands.some((cmd) => cmd.command === `/${commandName}`)
        if (isKnownCommand) {
          await store.executeCommand(agentId, commandName, commandArgs)
          return true
        }
        return false
      }
    }
  }, [agentCommands, store])

  // ── Detail drawer actions ──
  const handleSendMessage = useCallback(async (text: string) => {
    if (!selectedAgentId) return
    const trimmedText = text.trim()

    if (trimmedText === NEW_AGENT_COMMAND || trimmedText.startsWith(`${NEW_AGENT_COMMAND} `)) {
      const followUpPrompt = trimmedText.slice(NEW_AGENT_COMMAND.length).trim() || undefined
      await store.resetSession(selectedAgentId, followUpPrompt)
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

    await store.sendMessage(selectedAgentId, text)
  }, [handleBuiltInCommand, selectedAgentId, store])

  const handleApprove = useCallback(async (permissionId: string) => {
    if (!selectedAgentId) return
    await store.respondToPermission(selectedAgentId, permissionId, 'once')
  }, [selectedAgentId, store])

  const handleDeny = useCallback(async (permissionId: string) => {
    if (!selectedAgentId) return
    await store.respondToPermission(selectedAgentId, permissionId, 'reject')
  }, [selectedAgentId, store])

  const handleAbort = useCallback(async () => {
    if (!selectedAgentId) return
    await store.abortAgent(selectedAgentId)
  }, [selectedAgentId, store])

  const handleCreatePr = useCallback(async () => {
    if (!selectedAgentId) return
    await store.sendMessage(selectedAgentId, loadSettings().createPrPrompt)
  }, [selectedAgentId, store])

  const handleOpenInEditor = useCallback(() => {
    if (!selectedAgentId) return
    const liveAgent = findLiveAgent(selectedAgentId)
    if (!liveAgent) return
    const settings = loadSettings()
    window.api.openInEditor({ path: liveAgent.directory, editor: settings.editor as 'vscode' | 'cursor' | 'windsurf' })
  }, [selectedAgentId, findLiveAgent])

  const handleCreatePrForAgent = useCallback(async (agentId: string) => {
    await store.sendMessage(agentId, loadSettings().createPrPrompt)
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
    window.api.openInEditor({ path: liveAgent.directory, editor: settings.editor as 'vscode' | 'cursor' | 'windsurf' })
  }, [findLiveAgent])

  // ── Launch modal actions ──
  const handleLaunch = useCallback(async (
    directory: string,
    prompt?: string,
    title?: string,
    _model?: string,
    worktreeStrategy?: string
  ) => {
    let launchDirectory = directory

    if (worktreeStrategy === 'new-worktree') {
      const repoRootResult = await window.api.getRepoRoot(directory)
      if (!repoRootResult.ok || !repoRootResult.data) {
        console.error('Failed to resolve repo root for launch:', repoRootResult.error)
        return
      }

      const directoryParts = directory.replace(/\/$/, '').split('/').filter(Boolean)
      const projectSlug = sanitizeSlugSegment(directoryParts[directoryParts.length - 1] ?? 'project', 'project')
      const taskSource = title?.trim() || prompt?.trim() || 'agent'
      const taskSlug = sanitizeSlugSegment(taskSource, 'agent')
      const worktreeResult = await window.api.createWorktree({
        repoRoot: repoRootResult.data,
        projectSlug,
        taskSlug
      })

      if (!worktreeResult.ok || !worktreeResult.data) {
        console.error('Failed to create worktree for launch:', worktreeResult.error)
        return
      }

      launchDirectory = worktreeResult.data.worktreePath
    }

    const result = await store.launchAgent(launchDirectory, prompt || undefined, title)

    // Auto-open the detail drawer for the newly launched agent
    // (especially useful when no prompt is given so the user can interact immediately)
    if (result?.ok && result.data) {
      const data = result.data as { id: string }
      setSelectedAgentId(data.id)
    }
  }, [store])

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

      // L -> open launch modal
      if (event.key === 'l' || event.key === 'L') {
        if (!showLaunchModal && !showSettings) {
          setShowLaunchModal(true)
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
    [filteredAgents, selectedAgentId, showLaunchModal, showSettings, showCommandPalette, findPermissionForAgent, store]
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

      {displayInterrupts.length > 0 && (
        <InterruptBanner
          interrupts={displayInterrupts}
          onReviewAll={() => setFilter('blocked')}
        />
      )}

      <FilterBar
        filter={filter}
        onFilterChange={setFilter}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        counts={counts}
        projects={projectNames}
      />

      <FleetTable
        agents={filteredAgents}
        selectedId={selectedAgentId}
        onSelect={setSelectedAgentId}
        onSort={handleSort}
        onApprove={handleRowApprove}
        onReply={handleRowReply}
        onStop={handleRowStop}
        onOpen={handleRowOpen}
        onRemove={handleRemoveAgent}
        onRename={(agentId, newName) => store.renameAgent(agentId, newName)}
        onOpenTerminal={handleOpenTerminal}
        onOpenInEditor={handleOpenInEditorForAgent}
        onCreatePr={handleCreatePrForAgent}
      />

      <StatusBar
        agentCount={displayAgents.length}
        projectCount={projectNames.length}
        healthy={store.healthy}
      />

      {selectedAgent && (
        <DetailDrawer
          agent={selectedAgent}
          messages={selectedMessages}
          permission={selectedPermission}
          files={selectedFiles}
          tools={selectedTools}
          events={selectedEvents}
          commands={agentCommands}
          onClose={() => setSelectedAgentId(null)}
          onSendMessage={handleSendMessage}
          onApprove={selectedPermission ? () => handleApprove(selectedPermission.id) : undefined}
          onDeny={selectedPermission ? () => handleDeny(selectedPermission.id) : undefined}
          onAbort={handleAbort}
          onRemove={() => void handleRemoveAgent(selectedAgent.id)}
          onCreatePr={handleCreatePr}
          onOpenInEditor={handleOpenInEditor}
        />
      )}

      {showLaunchModal && (
        <LaunchModal
          onClose={() => setShowLaunchModal(false)}
          onLaunch={handleLaunch}
          onSelectDirectory={store.selectDirectory}
          onValidateDirectory={handleValidateDirectory}
        />
      )}

      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}

      {showModelPicker && selectedAgentId && (
        <ModelPickerModal
          agentId={selectedAgentId}
          currentModel={selectedAgent?.model}
          onClose={() => setShowModelPicker(false)}
          onSelect={async (modelPath) => {
            if (!selectedAgentId) return
            const result = await window.api.updateConfig(selectedAgentId, { model: modelPath })
            if (result.ok) {
              setShowModelPicker(false)
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
          onOpenSettings={() => {
            setShowCommandPalette(false)
            setShowSettings(true)
          }}
          onFilterChange={(newFilter) => {
            setFilter(newFilter)
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
