/**
 * Mock window.api for demo/screenshot mode.
 * Activated by OC_ORCHESTRATOR_DEMO_MODE=1
 */

import type { OrchestratorApi, IpcResult } from './types/api'

const ok = <T>(data: T): Promise<IpcResult<T>> =>
  Promise.resolve({ ok: true, data })

const noop = (): Promise<IpcResult> => ok(undefined)

const noopListener = (): (() => void) => () => {}

const DEMO_AGENTS = [
  {
    id: 'agent-1',
    runtimeId: 'runtime-1',
    sessionId: 'session-1',
    directory: '/Users/dev/projects/api-gateway',
    projectName: 'api-gateway',
    branchName: 'oco/agent-1/add-rate-limiting',
    isWorktree: true,
    workspaceName: 'agent-1',
    prompt: 'Add rate limiting middleware with Redis backing store',
    title: 'Add rate limiting middleware with Redis backing store',
    displayName: 'Rate Limiter',
    taskSummary: 'Add rate limiting middleware with Redis backing store',
    persistedStatus: undefined,
    prUrl: 'https://github.com/acme/api-gateway/pull/142'
  },
  {
    id: 'agent-2',
    runtimeId: 'runtime-1',
    sessionId: 'session-2',
    directory: '/Users/dev/projects/api-gateway',
    projectName: 'api-gateway',
    branchName: 'oco/agent-2/fix-auth-refresh',
    isWorktree: true,
    workspaceName: 'agent-2',
    prompt: 'Fix token refresh race condition in auth middleware',
    title: 'Fix token refresh race condition in auth middleware',
    displayName: 'Auth Fix',
    taskSummary: 'Fix token refresh race condition in auth middleware',
    persistedStatus: undefined,
    prUrl: undefined
  },
  {
    id: 'agent-3',
    runtimeId: 'runtime-2',
    sessionId: 'session-3',
    directory: '/Users/dev/projects/web-dashboard',
    projectName: 'web-dashboard',
    branchName: 'oco/agent-3/dark-mode',
    isWorktree: true,
    workspaceName: 'agent-3',
    prompt: 'Implement dark mode theme with system preference detection',
    title: 'Implement dark mode theme with system preference detection',
    displayName: 'Dark Mode',
    taskSummary: 'Implement dark mode with system preference detection',
    persistedStatus: 'completed_manual',
    prUrl: 'https://github.com/acme/web-dashboard/pull/89'
  },
  {
    id: 'agent-4',
    runtimeId: 'runtime-2',
    sessionId: 'session-4',
    directory: '/Users/dev/projects/web-dashboard',
    projectName: 'web-dashboard',
    branchName: 'oco/agent-4/perf-audit',
    isWorktree: true,
    workspaceName: 'agent-4',
    prompt: 'Audit and fix React re-render performance issues on the analytics page',
    title: 'Audit and fix React re-render performance issues on the analytics page',
    displayName: 'Perf Audit',
    taskSummary: 'Audit and fix React re-render performance on analytics page',
    persistedStatus: undefined,
    prUrl: undefined
  },
  {
    id: 'agent-5',
    runtimeId: 'runtime-3',
    sessionId: 'session-5',
    directory: '/Users/dev/projects/billing-service',
    projectName: 'billing-service',
    branchName: 'oco/agent-5/stripe-migration',
    isWorktree: true,
    workspaceName: 'agent-5',
    prompt: 'Migrate from Stripe Charges API to Payment Intents',
    title: 'Migrate from Stripe Charges API to Payment Intents',
    displayName: 'Stripe Migration',
    taskSummary: 'Migrate from Stripe Charges API to Payment Intents',
    persistedStatus: undefined,
    prUrl: undefined
  },
  {
    id: 'agent-6',
    runtimeId: 'runtime-3',
    sessionId: 'session-6',
    directory: '/Users/dev/projects/billing-service',
    projectName: 'billing-service',
    branchName: 'oco/agent-6/invoice-pdf',
    isWorktree: true,
    workspaceName: 'agent-6',
    prompt: 'Generate PDF invoices with company branding',
    title: 'Generate PDF invoices with company branding',
    displayName: 'Invoice PDF',
    taskSummary: 'Generate PDF invoices with company branding',
    persistedStatus: 'in_review',
    prUrl: 'https://github.com/acme/billing-service/pull/67'
  },
  {
    id: 'agent-7',
    runtimeId: 'runtime-4',
    sessionId: 'session-7',
    directory: '/Users/dev/projects/mobile-app',
    projectName: 'mobile-app',
    branchName: 'oco/agent-7/push-notifications',
    isWorktree: true,
    workspaceName: 'agent-7',
    prompt: 'Add push notification support with Firebase Cloud Messaging',
    title: 'Add push notification support with Firebase Cloud Messaging',
    displayName: 'Push Notifications',
    taskSummary: 'Add push notification support with FCM',
    persistedStatus: undefined,
    prUrl: undefined
  },
  {
    id: 'agent-8',
    runtimeId: 'runtime-5',
    sessionId: 'session-8',
    directory: '/Users/dev/projects/data-pipeline',
    projectName: 'data-pipeline',
    branchName: 'oco/agent-8/kafka-consumer',
    isWorktree: true,
    workspaceName: 'agent-8',
    prompt: 'Implement Kafka consumer for real-time event processing',
    title: 'Implement Kafka consumer for real-time event processing',
    displayName: 'Kafka Consumer',
    taskSummary: 'Implement Kafka consumer for real-time event processing',
    persistedStatus: undefined,
    prUrl: 'https://github.com/acme/data-pipeline/pull/203'
  },
  {
    id: 'agent-9',
    runtimeId: 'runtime-5',
    sessionId: 'session-9',
    directory: '/Users/dev/projects/data-pipeline',
    projectName: 'data-pipeline',
    branchName: 'oco/agent-9/add-tests',
    isWorktree: true,
    workspaceName: 'agent-9',
    prompt: 'Add integration tests for the ETL transform stage',
    title: 'Add integration tests for the ETL transform stage',
    displayName: 'ETL Tests',
    taskSummary: 'Add integration tests for the ETL transform stage',
    persistedStatus: undefined,
    prUrl: undefined
  },
  {
    id: 'agent-10',
    runtimeId: 'runtime-6',
    sessionId: 'session-10',
    directory: '/Users/dev/projects/infra-config',
    projectName: 'infra-config',
    branchName: 'oco/agent-10/terraform-modules',
    isWorktree: true,
    workspaceName: 'agent-10',
    prompt: 'Refactor Terraform configs into reusable modules',
    title: 'Refactor Terraform configs into reusable modules',
    displayName: 'Terraform Modules',
    taskSummary: 'Refactor Terraform configs into reusable modules',
    persistedStatus: undefined,
    prUrl: undefined
  },
  {
    id: 'agent-11',
    runtimeId: 'runtime-4',
    sessionId: 'session-11',
    directory: '/Users/dev/projects/mobile-app',
    projectName: 'mobile-app',
    branchName: 'oco/agent-11/offline-sync',
    isWorktree: true,
    workspaceName: 'agent-11',
    prompt: 'Implement offline-first data sync with conflict resolution',
    title: 'Implement offline-first data sync with conflict resolution',
    displayName: 'Offline Sync',
    taskSummary: 'Implement offline-first data sync with conflict resolution',
    persistedStatus: undefined,
    prUrl: undefined
  },
  {
    id: 'agent-12',
    runtimeId: 'runtime-7',
    sessionId: 'session-12',
    directory: '/Users/dev/projects/docs-site',
    projectName: 'docs-site',
    branchName: 'oco/agent-12/search-index',
    isWorktree: true,
    workspaceName: 'agent-12',
    prompt: 'Build full-text search index with Algolia integration',
    title: 'Build full-text search index with Algolia integration',
    displayName: 'Search Index',
    taskSummary: 'Build full-text search index with Algolia integration',
    persistedStatus: 'completed_manual',
    prUrl: 'https://github.com/acme/docs-site/pull/45'
  }
]

// Status types must match what mapSessionStatus expects:
// 'busy' -> running, 'idle' -> idle, 'completed' -> completed,
// 'error' -> errored, 'waiting' -> needs_input
const DEMO_STATUSES: Record<string, { agentId: string; status: { type: string } }> = {
  'agent-1': { agentId: 'agent-1', status: { type: 'busy' } },
  'agent-2': { agentId: 'agent-2', status: { type: 'waiting' } },
  'agent-3': { agentId: 'agent-3', status: { type: 'completed' } },
  'agent-4': { agentId: 'agent-4', status: { type: 'busy' } },
  'agent-5': { agentId: 'agent-5', status: { type: 'waiting' } },
  'agent-6': { agentId: 'agent-6', status: { type: 'idle' } },
  'agent-7': { agentId: 'agent-7', status: { type: 'busy' } },
  'agent-8': { agentId: 'agent-8', status: { type: 'completed' } },
  'agent-9': { agentId: 'agent-9', status: { type: 'busy' } },
  'agent-10': { agentId: 'agent-10', status: { type: 'error' } },
  'agent-11': { agentId: 'agent-11', status: { type: 'busy' } },
  'agent-12': { agentId: 'agent-12', status: { type: 'completed' } }
}

const DEMO_MODELS: Record<string, string> = {
  'agent-1': 'claude-sonnet-4-6',
  'agent-2': 'claude-sonnet-4-6',
  'agent-3': 'claude-sonnet-4-6',
  'agent-4': 'claude-opus-4-6',
  'agent-5': 'claude-sonnet-4-6',
  'agent-6': 'claude-sonnet-4-6',
  'agent-7': 'claude-opus-4-6',
  'agent-8': 'claude-sonnet-4-6',
  'agent-9': 'claude-sonnet-4-6',
  'agent-10': 'claude-sonnet-4-6',
  'agent-11': 'claude-opus-4-6',
  'agent-12': 'claude-sonnet-4-6'
}

function makeDemoMessages(agentId: string) {
  const agent = DEMO_AGENTS.find((a) => a.id === agentId)
  if (!agent) return []

  const now = Date.now()
  return [
    {
      info: {
        id: `msg-${agentId}-1`,
        sessionID: agent.sessionId,
        role: 'user' as const,
        time: { created: now - 60000 }
      },
      parts: [{ id: `part-${agentId}-1`, type: 'text', text: agent.prompt }]
    },
    {
      info: {
        id: `msg-${agentId}-2`,
        sessionID: agent.sessionId,
        role: 'assistant' as const,
        parentID: `msg-${agentId}-1`,
        time: { created: now - 55000 },
        modelID: DEMO_MODELS[agentId] || 'claude-sonnet-4-6'
      },
      parts: [
        { id: `part-${agentId}-2`, type: 'text', text: `I'll start working on this. Let me analyze the codebase first.` },
        {
          id: `part-${agentId}-3`,
          type: 'tool-invocation',
          tool: 'read_file',
          state: { status: 'completed', title: 'Read src/index.ts' }
        }
      ]
    }
  ]
}

export function createDemoApi(): OrchestratorApi {
  return {
    // ── Agent Operations ──
    launchAgent: noop,
    sendMessage: noop,
    sendMessageWithModel: noop,
    respondToPermission: noop,
    abortAgent: noop,
    removeAgent: noop,
    resetSession: noop,
    getMessages: (agentId: string) => ok(makeDemoMessages(agentId)),
    listCommands: () => ok([]),
    executeCommand: noop,
    getConfig: (agentId: string) => ok({ model: DEMO_MODELS[agentId] || 'claude-sonnet-4-6' }),
    updateConfig: noop,
    getProviders: () => ok({}),
    getMcpStatus: () => ok({ servers: [] }),
    connectMcp: noop,
    disconnectMcp: noop,
    compactSession: noop,
    shareSession: noop,
    listAgentConfigs: () => ok([]),
    listTools: () => ok([]),
    listSessions: () => ok([]),
    listSessionsByProject: () => ok([]),
    forkSession: () => ok({ sessionId: 'demo-fork', title: 'Forked session' }),
    resumeAgent: noop,
    listAgents: () => ok(DEMO_AGENTS),
    isAgentsRestored: () => ok(true),
    updateAgentMeta: noop,
    getStatuses: () => ok(DEMO_STATUSES),
    replyToQuestion: noop,
    rejectQuestion: noop,
    listQuestions: () => ok([]),
    listPermissions: () => ok([]),

    // ── Runtime Operations ──
    listRuntimes: () => ok([]),
    stopRuntime: noop,
    listAllProviders: () => ok({}),
    getSystemConfig: () => ok({}),
    listAllCommands: () => ok([]),
    listAllAgentConfigs: () => ok([]),

    // ── Dialog ──
    selectDirectory: () => ok(''),

    // ── Workspace Operations ──
    validateGitRepo: () => ok(true),
    getWorktreeRoot: () => ok('/tmp/worktrees'),
    getRepoRoot: () => ok('/tmp/repo'),
    getCommonRepoRoot: () => ok('/tmp/repo'),
    createWorktree: () => ok({ worktreePath: '/tmp/wt', branchName: 'demo' }),
    createFreshWorktree: () => ok({ worktreePath: '/tmp/wt', branchName: 'demo', baseRef: 'main' }),
    getDefaultBranch: () => ok('origin/main'),
    removeWorktree: noop,
    listWorktrees: () => ok([]),
    getWorktreeStatus: () => ok({ dirty: false, changedFiles: 0 }),
    getGitStatus: () => ok([]),
    getGitDiff: () => ok({ before: '', after: '' }),
    readFile: () => ok({ content: '', mtimeMs: 0, size: 0, encoding: 'utf-8' as const, truncated: false }),
    writeFile: () => ok({ mtimeMs: 0, size: 0 }),
    watchFile: () => Promise.resolve({ ok: true } as const),
    unwatchFile: () => Promise.resolve({ ok: true } as const),
    onFileChanged: () => () => {},

    // ── Database: Projects ──
    listProjects: () => ok([]),
    createProject: () => ok({ id: '1', name: 'demo', repo_root: '/tmp', default_branch: null, fresh_worktree: 0, created_at: '', updated_at: '' }),
    ensureProject: () => ok({ id: '1', name: 'demo', repo_root: '/tmp', default_branch: null, fresh_worktree: 0, created_at: '', updated_at: '' }),
    deleteProject: () => ok(true),
    updateProjectSettings: () => ok({ id: '1', name: 'demo', repo_root: '/tmp', default_branch: null, fresh_worktree: 0, created_at: '', updated_at: '' }),

    // ── Database: Custom Labels ──
    listCustomLabels: () => ok([]),
    createCustomLabel: () => ok({ id: 'custom', name: 'Custom', color_key: 'blue', created_at: '' }),
    updateCustomLabel: () => ok({ id: 'custom', name: 'Custom', color_key: 'blue', created_at: '' }),
    deleteCustomLabel: () => ok(true),

    // ── Database: Preferences ──
    getPreference: () => ok(undefined),
    setPreference: noop,

    // ── Notifications ──
    getNotificationPreferences: () => ok({
      needs_approval: true,
      needs_input: true,
      errored: true,
      completed: true,
      disconnected: false
    }),
    setNotificationPreference: noop,
    getSoundEnabled: () => ok(true),
    setSoundEnabled: noop,
    getPendingNotificationAgent: () => ok(null),

    // ── App Info ──
    getVersion: () => ok('1.0.0'),
    getHomeDirectory: () => ok('/Users/dev'),
    setBadgeCount: noop,

    // ── Shell Integration ──
    notifyAgentStatus: noop,
    openInEditor: noop,
    openTerminal: noop,
    openExternal: noop,

    // ── Event Listeners ──
    onEvent: noopListener,
    onAgentLaunched: noopListener,
    onSessionReset: noopListener,
    onRuntimeStarted: noopListener,
    onRuntimeStopped: noopListener,
    onEventError: noopListener,
    onUpdateAvailable: noopListener,
    onNotificationSelectAgent: noopListener,
    onAgentsRestored: noopListener,
    onMenuOpenSettings: noopListener
  }
}
