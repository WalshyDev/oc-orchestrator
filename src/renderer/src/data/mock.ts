import type { AgentRuntime, Interrupt, Message, Project } from '../types'

export const mockProjects: Project[] = [
  { id: 'proj-1', name: 'workers-api', repoRoot: '/home/dev/workers-api', color: '#f97316' },
  { id: 'proj-2', name: 'dash-ui', repoRoot: '/home/dev/dash-ui', color: '#60a5fa' },
  { id: 'proj-3', name: 'infra-core', repoRoot: '/home/dev/infra-core', color: '#a78bfa' }
]

export const mockAgents: AgentRuntime[] = [
  {
    id: 'agent-1',
    name: 'auth-refactor',
    projectId: 'proj-1',
    projectName: 'workers-api',
    branchName: 'feat/auth-refactor-0328',
    taskSummary: 'Refactoring auth middleware to use new JWT validation',
    status: 'needs_approval',
    model: 'opus-4',
    lastActivityAt: '4m ago',
    blockedSince: '4m ago'
  },
  {
    id: 'agent-2',
    name: 'fix-rate-limits',
    projectId: 'proj-1',
    projectName: 'workers-api',
    branchName: 'fix/rate-limits-0328',
    taskSummary: 'Which rate limit strategy? Token bucket or sliding window?',
    status: 'needs_input',
    model: 'sonnet-4',
    lastActivityAt: '2m ago',
    blockedSince: '2m ago'
  },
  {
    id: 'agent-3',
    name: 'db-migration',
    projectId: 'proj-3',
    projectName: 'infra-core',
    branchName: 'chore/db-idx-0328',
    taskSummary: 'Ready to run migration: add index on users.email',
    status: 'needs_approval',
    model: 'opus-4',
    lastActivityAt: '1m ago',
    blockedSince: '1m ago'
  },
  {
    id: 'agent-4',
    name: 'component-tests',
    projectId: 'proj-2',
    projectName: 'dash-ui',
    branchName: 'test/datatable-0328',
    taskSummary: 'Writing integration tests for DataTable component',
    status: 'running',
    model: 'sonnet-4',
    lastActivityAt: '12s ago'
  },
  {
    id: 'agent-5',
    name: 'api-docs',
    projectId: 'proj-1',
    projectName: 'workers-api',
    branchName: 'docs/openapi-v2-0328',
    taskSummary: 'Generating OpenAPI specs for v2 endpoints',
    status: 'running',
    model: 'sonnet-4',
    lastActivityAt: '8s ago'
  },
  {
    id: 'agent-6',
    name: 'perf-optimize',
    projectId: 'proj-2',
    projectName: 'dash-ui',
    branchName: 'perf/rerenders-0328',
    taskSummary: 'Profiling and optimizing re-renders in fleet board',
    status: 'running',
    model: 'opus-4',
    lastActivityAt: '22s ago'
  },
  {
    id: 'agent-7',
    name: 'error-handling',
    projectId: 'proj-1',
    projectName: 'workers-api',
    branchName: 'feat/errors-0328',
    taskSummary: 'Implementing structured error responses across all routes',
    status: 'running',
    model: 'sonnet-4',
    lastActivityAt: '45s ago'
  },
  {
    id: 'agent-8',
    name: 'sidebar-rework',
    projectId: 'proj-2',
    projectName: 'dash-ui',
    branchName: 'feat/sidebar-v2-0328',
    taskSummary: 'Rebuilding sidebar with collapsible sections',
    status: 'running',
    model: 'sonnet-4',
    lastActivityAt: '1m ago'
  },
  {
    id: 'agent-9',
    name: 'ci-pipeline',
    projectId: 'proj-3',
    projectName: 'infra-core',
    branchName: 'chore/ci-parallel-0328',
    taskSummary: 'Setting up parallel test runners in GitHub Actions',
    status: 'running',
    model: 'sonnet-4',
    lastActivityAt: '30s ago'
  },
  {
    id: 'agent-10',
    name: 'logging-update',
    projectId: 'proj-1',
    projectName: 'workers-api',
    branchName: 'chore/logging-0328',
    taskSummary: 'Migrating from console.log to structured logging',
    status: 'running',
    model: 'sonnet-4',
    lastActivityAt: '15s ago'
  },
  {
    id: 'agent-11',
    name: 'type-cleanup',
    projectId: 'proj-2',
    projectName: 'dash-ui',
    branchName: 'chore/strict-ts-0328',
    taskSummary: 'Completed strict mode migration, awaiting review',
    status: 'idle',
    model: 'sonnet-4',
    lastActivityAt: '8m ago'
  },
  {
    id: 'agent-12',
    name: 'dep-update',
    projectId: 'proj-3',
    projectName: 'infra-core',
    branchName: 'chore/deps-0328',
    taskSummary: 'Updated all deps, no breaking changes found',
    status: 'completed',
    model: 'haiku-3',
    lastActivityAt: '12m ago'
  }
]

export const mockInterrupts: Interrupt[] = [
  {
    id: 'int-1',
    runtimeId: 'agent-1',
    agentName: 'auth-refactor',
    projectName: 'workers-api',
    kind: 'needs_approval',
    reason: 'Requesting write access to src/middleware/auth.ts',
    createdAt: '4m ago'
  },
  {
    id: 'int-2',
    runtimeId: 'agent-2',
    agentName: 'fix-rate-limits',
    projectName: 'workers-api',
    kind: 'needs_input',
    reason: 'Token bucket or sliding window for rate limiting?',
    createdAt: '2m ago'
  },
  {
    id: 'int-3',
    runtimeId: 'agent-3',
    agentName: 'db-migration',
    projectName: 'infra-core',
    kind: 'needs_approval',
    reason: 'Ready to execute migration: add index on users.email',
    createdAt: '1m ago'
  }
]

export const mockMessages: Message[] = [
  {
    id: 'msg-1',
    role: 'user',
    content: 'Refactor the auth middleware to use the new JWT validation library. Keep backwards compat with the existing token format.',
    timestamp: '14m ago'
  },
  {
    id: 'msg-2',
    role: 'assistant',
    content: "I'll refactor the auth middleware. Let me start by examining the current implementation and the new JWT library.",
    timestamp: '14m ago'
  },
  {
    id: 'msg-3',
    role: 'tool',
    content: 'Read src/middleware/auth.ts',
    timestamp: '13m ago'
  },
  {
    id: 'msg-4',
    role: 'tool',
    content: 'Read src/lib/jwt.ts',
    timestamp: '13m ago'
  },
  {
    id: 'msg-5',
    role: 'tool',
    content: 'Read src/lib/jwt-v2.ts',
    timestamp: '12m ago'
  },
  {
    id: 'msg-6',
    role: 'assistant',
    content: "I've analyzed the current auth setup. The existing middleware uses jsonwebtoken directly with a custom wrapper. The new v2 library has a different API surface but supports the same token format.\n\nI'll now refactor the middleware to:\n1. Use the new jwt-v2 validation\n2. Keep the legacy token format support\n3. Add proper TypeScript types for the decoded payload\n\nI need to write to src/middleware/auth.ts with the refactored code.",
    timestamp: '4m ago'
  }
]

export function getBlockedCount(agents: AgentRuntime[]): number {
  return agents.filter((agent) => agent.status === 'needs_input' || agent.status === 'needs_approval').length
}

export function getRunningCount(agents: AgentRuntime[]): number {
  return agents.filter((agent) => agent.status === 'running').length
}

export function getIdleCount(agents: AgentRuntime[]): number {
  return agents.filter((agent) => agent.status === 'idle' || agent.status === 'completed').length
}
