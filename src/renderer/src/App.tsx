import { useState, useMemo, useCallback, useEffect } from 'react'
import { TopBar } from './components/TopBar'
import { InterruptBanner } from './components/InterruptBanner'
import { FilterBar, matchesFilter, type FilterValue } from './components/FilterBar'
import { FleetTable } from './components/FleetTable'
import { StatusBar } from './components/StatusBar'
import { DetailDrawer } from './components/DetailDrawer'
import { LaunchModal } from './components/LaunchModal'
import { SettingsModal } from './components/SettingsModal'
import { CommandPalette } from './components/CommandPalette'
import { useAgentStore, type LiveAgent } from './hooks/useAgentStore'
import type { AgentRuntime, Interrupt, Message } from './types'
import type { FileChange } from './components/FilesChanged'
import type { ToolCall } from './components/ToolsUsage'
import type { EventEntry } from './components/EventLog'

type SortColumn = 'agent' | 'status' | 'task' | 'branch' | 'model' | 'activity'
type SortDirection = 'asc' | 'desc'

const CREATE_PR_PROMPT = `Prepare this work for review.

1. Check the current git branch. If it is not already a feature branch, create and switch to a sensible feature branch first.
2. Review the working tree, then create a concise but informative commit message. Do not list changed files in the commit message.
3. Commit the relevant changes.
4. Push the branch.
5. Open a pull request. Try GitHub with gh if the remote is GitHub, or GitLab with glab if the remote is GitLab.
6. If opening the PR with gh or glab does not work, that is fine - give me the PR URL if you can determine it, or the exact compare/create URL I should open manually.

Return the final PR URL or manual URL, plus a short note on what you committed.`

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

function buildToolCall(partId: string, toolName: string | undefined, toolState: string | undefined, text: string | undefined, timestamp: number): ToolCall {
  return {
    id: partId,
    name: toolName ?? 'unknown',
    state: mapToolState(toolState),
    input: undefined,
    output: text ?? undefined,
    timestamp
  }
}

export function App() {
  const [filter, setFilter] = useState<FilterValue>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [showLaunchModal, setShowLaunchModal] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null)
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [freshSessionState, setFreshSessionState] = useState<{
    sourceAgentId: string
    nextAgentId?: string
    branchName?: string
    status: 'creating' | 'ready'
  } | null>(null)
  const [, setTick] = useState(0)

  const store = useAgentStore()

  // ── Live timestamp refresh (every 30s) ──
  useEffect(() => {
    const interval = setInterval(() => {
      setTick((prev) => prev + 1)
    }, 30_000)
    return () => clearInterval(interval)
  }, [])

  // ── Convert live agents to AgentRuntime shape ──
  const liveAgentsAsRuntimes: AgentRuntime[] = useMemo(() => {
    return store.agents.map((agent): AgentRuntime => ({
      id: agent.id,
      name: agent.name,
      projectId: agent.directory,
      projectName: agent.projectName,
      branchName: agent.branchName,
      taskSummary: agent.taskSummary,
      status: agent.status,
      model: agent.model,
      lastActivityAt: formatTimeAgo(agent.lastActivityAt),
      blockedSince: agent.blockedSince ? formatTimeAgo(agent.blockedSince) : undefined
    }))
  }, [store.agents])

  // ── Convert live permissions to Interrupt shape ──
  const liveInterrupts: Interrupt[] = useMemo(() => {
    return store.permissions.map((perm): Interrupt => {
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
    if (freshSessionState?.status === 'creating' && freshSessionState.sourceAgentId === selectedAgent.id) {
      return []
    }

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
        .map((part) => buildToolCall(part.id, part.toolName, part.toolState, part.text, msg.createdAt))

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
  }, [freshSessionState, selectedAgent, store])

  // ── Extract file changes from store messages ──
  const selectedFiles: FileChange[] = useMemo(() => {
    if (!selectedAgent) return []
    const liveAgent = store.agents.find((agent) => agent.id === selectedAgent.id)
    if (!liveAgent) return []

    const liveMessages = store.getMessagesForSession(liveAgent.sessionId)
    const files: FileChange[] = []
    const seenPaths = new Set<string>()

    for (const msg of liveMessages) {
      for (const part of msg.parts) {
        if (part.type === 'tool' && part.toolName === 'file.edited' && part.text) {
          const filePath = part.text.trim()
          if (filePath && !seenPaths.has(filePath)) {
            seenPaths.add(filePath)
            files.push({
              path: filePath,
              action: 'modified',
              timestamp: msg.createdAt
            })
          }
        }
      }
    }

    return files
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
          tools.push(buildToolCall(part.id, part.toolName, part.toolState, part.text, msg.createdAt))
        }
      }
    }

    return tools
  }, [selectedAgent, store])

  // ── Events from store messages ──
  const selectedEvents: EventEntry[] = useMemo(() => {
    if (!selectedAgent) return []
    const liveAgent = store.agents.find((agent) => agent.id === selectedAgent.id)
    if (!liveAgent) return []

    const liveMessages = store.getMessagesForSession(liveAgent.sessionId)
    const events: EventEntry[] = []

    for (const msg of liveMessages) {
      for (const part of msg.parts) {
        if (part.type === 'step-start' || part.type === 'step-finish') {
          events.push({
            id: part.id,
            type: part.type,
            summary: part.text ?? part.type,
            timestamp: msg.createdAt,
            data: null
          })
        }
      }
    }

    return events
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

  // ── Selection handler ──
  const handleSelectionChange = useCallback((ids: Set<string>) => {
    setSelectedIds(ids)
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

  // ── Bulk actions ──
  const handleBulkStop = useCallback(async () => {
    const promises = Array.from(selectedIds).map((agentId) => store.abortAgent(agentId))
    await Promise.allSettled(promises)
    setSelectedIds(new Set())
  }, [selectedIds, store])

  const handleBulkApprove = useCallback(async () => {
    const promises = Array.from(selectedIds).map((agentId) => {
      const permission = findPermissionForAgent(agentId)
      if (permission) {
        return store.respondToPermission(agentId, permission.id, 'once')
      }
      return Promise.resolve()
    })
    await Promise.allSettled(promises)
    setSelectedIds(new Set())
  }, [selectedIds, findPermissionForAgent, store])

  // ── Detail drawer actions ──
  const handleSendMessage = useCallback(async (text: string) => {
    if (!selectedAgentId) return
    const trimmedText = text.trim()

    if (trimmedText === NEW_AGENT_COMMAND || trimmedText.startsWith(`${NEW_AGENT_COMMAND} `)) {
      const liveAgent = findLiveAgent(selectedAgentId)
      if (!liveAgent) return

      const followUpPrompt = trimmedText.slice(NEW_AGENT_COMMAND.length).trim()
      setFreshSessionState({ sourceAgentId: selectedAgentId, status: 'creating' })

      const repoRootResult = await window.api.getRepoRoot(liveAgent.directory)
      if (!repoRootResult.ok || !repoRootResult.data) {
        console.error('Failed to resolve repo root for /new:', repoRootResult.error)
        setFreshSessionState(null)
        return
      }

      const projectSlug = sanitizeSlugSegment(liveAgent.projectName, 'project')
      const taskSlug = sanitizeSlugSegment(followUpPrompt || 'next-feature', 'next-feature')
      const worktreeResult = await window.api.createFreshWorktree({
        repoRoot: repoRootResult.data,
        projectSlug,
        taskSlug
      })

      if (!worktreeResult.ok || !worktreeResult.data) {
        console.error('Failed to create fresh worktree for /new:', worktreeResult.error)
        setFreshSessionState(null)
        return
      }

      const launchResult = await store.launchAgent(
        worktreeResult.data.worktreePath,
        followUpPrompt || undefined,
        undefined
      )

      if (launchResult?.ok && launchResult.data) {
        const data = launchResult.data as { id: string }
        store.prepareFreshAgent(data.id, followUpPrompt || undefined)
        setFreshSessionState({
          sourceAgentId: selectedAgentId,
          nextAgentId: data.id,
          branchName: worktreeResult.data.branchName,
          status: 'ready'
        })
        setSelectedAgentId(data.id)
      } else {
        setFreshSessionState(null)
      }
      return
    }

    await store.sendMessage(selectedAgentId, text)
  }, [findLiveAgent, selectedAgentId, store])

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
    await store.sendMessage(selectedAgentId, CREATE_PR_PROMPT)
  }, [selectedAgentId, store])

  const handleOpenInEditor = useCallback(() => {
    if (!selectedAgentId) return
    const liveAgent = findLiveAgent(selectedAgentId)
    if (!liveAgent) return
    // Attempt to open in the configured editor via IPC
    const apiObj = window.api as unknown as Record<string, unknown> | undefined
    if (apiObj && typeof apiObj.openInEditor === 'function') {
      (apiObj.openInEditor as (dir: string) => void)(liveAgent.directory)
    }
  }, [selectedAgentId, findLiveAgent])

  // ── Launch modal actions ──
  const handleLaunch = useCallback(async (
    directory: string,
    prompt?: string,
    title?: string,
    _model?: string,
    _worktreeStrategy?: string
  ) => {
    const result = await store.launchAgent(directory, prompt || undefined, title)

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
        onSettings={() => setShowSettings(true)}
      />

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
        selectedIds={selectedIds}
        onSelectionChange={handleSelectionChange}
        onSort={handleSort}
        onApprove={handleRowApprove}
        onReply={handleRowReply}
        onStop={handleRowStop}
        onOpen={handleRowOpen}
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
          sessionNotice={freshSessionState?.nextAgentId === selectedAgent.id
            ? `Fresh session ready on ${freshSessionState.branchName ?? 'new branch'}`
            : freshSessionState?.status === 'creating' && freshSessionState.sourceAgentId === selectedAgent.id
              ? 'Starting fresh session...'
              : undefined}
          onClose={() => setSelectedAgentId(null)}
          onSendMessage={handleSendMessage}
          onApprove={selectedPermission ? () => handleApprove(selectedPermission.id) : undefined}
          onDeny={selectedPermission ? () => handleDeny(selectedPermission.id) : undefined}
          onAbort={handleAbort}
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
          onStopAll={handleBulkStop}
          onApproveAll={handleBulkApprove}
        />
      )}
    </div>
  )
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}
