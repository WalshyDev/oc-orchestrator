import type { LiveAgent } from './useAgentStore'

/**
 * A launch takes seconds to produce an agent — spawning `opencode serve` and
 * creating a worktree — so the fleet table shows an optimistic row in the
 * meantime. This module owns the shape and naming of that row, and the
 * bookkeeping for launches the user dismissed while they were still in flight.
 *
 * Kept free of store state so the reconciliation rules can be tested directly:
 * they are ordering-sensitive and the ways they can go wrong (a stale row left
 * at 'starting', a dismissed launch reappearing) are invisible until they bite.
 */

/** Placeholder ids are namespaced so they can never collide with main's `agent-N`. */
export const PLACEHOLDER_ID_PREFIX = 'pending-'

/**
 * Stands in for a model that isn't known yet — both on a placeholder and on a
 * real agent between arrival and the first `getConfig`. Exported because the UI
 * has to suppress the model picker while it's showing, and a copy of the literal
 * in the table would silently stop matching if this changed.
 */
export const UNRESOLVED_MODEL_LABEL = 'starting...'

export interface PlaceholderOptions {
  directory: string
  prompt?: string
  title?: string
}

export function projectNameFromDirectory(directory: string): string {
  return directory.split('/').filter(Boolean).pop() ?? directory
}

/**
 * Predicts the name the real agent will arrive with, so the row doesn't visibly
 * rename itself on arrival. An explicit title wins outright; a prompt-only launch
 * gets an auto-title that the store derives a name from. With neither, main mints
 * `<slug>-N` from a counter this side can't see, so the project name is the
 * closest available guess and a rename is unavoidable.
 */
export function predictPlaceholderName(
  options: PlaceholderOptions,
  deriveNameFromPrompt: (prompt: string) => string
): string {
  const title = options.title?.trim()
  if (title) return title.slice(0, 30)
  const prompt = options.prompt?.trim()
  if (prompt) return deriveNameFromPrompt(prompt)
  return projectNameFromDirectory(options.directory)
}

export function buildPlaceholderAgent(
  launchId: string,
  options: PlaceholderOptions,
  deriveNameFromPrompt: (prompt: string) => string
): LiveAgent {
  const projectName = projectNameFromDirectory(options.directory)
  return {
    id: launchId,
    runtimeId: '',
    // Placeholders have no session. Reusing the launch id keeps the per-session
    // maps keyed consistently so removeAgentState() cleans up after itself.
    sessionId: launchId,
    directory: options.directory,
    name: predictPlaceholderName(options, deriveNameFromPrompt),
    projectName,
    branchName: '',
    isWorktree: false,
    workspaceName: projectName,
    taskSummary: options.prompt?.trim().slice(0, 120) || 'Starting agent...',
    status: 'starting',
    labelIds: [],
    model: UNRESOLVED_MODEL_LABEL,
    prUrl: null,
    lastActivityAt: Date.now(),
    cost: 0,
    tokens: { input: 0, output: 0 },
    pending: true
  }
}

/**
 * Turns a placeholder into an errored row rather than letting it vanish, so the
 * user can read why the launch never produced an agent.
 */
export function applyLaunchFailure(agent: LiveAgent, message: string): void {
  agent.status = 'errored'
  agent.taskSummary = message ? `Launch failed: ${message}` : 'Launch failed'
  agent.lastActivityAt = Date.now()
  agent.lastError = {
    name: 'LaunchError',
    message,
    sessionId: agent.sessionId,
    occurredAt: Date.now()
  }
}

/** Keeps the newest `limit` entries, evicting oldest-first. */
class BoundedSet {
  private items = new Set<string>()

  constructor(private readonly limit: number) {}

  add(value: string): void {
    // Re-adding must refresh position, or a repeatedly-seen id could age out
    // while still relevant.
    this.items.delete(value)
    this.items.add(value)
    if (this.items.size > this.limit) {
      const oldest = this.items.values().next()
      if (!oldest.done) this.items.delete(oldest.value)
    }
  }

  has(value: string): boolean {
    return this.items.has(value)
  }
}

/**
 * Tracks launches dismissed mid-flight. The launch itself can't be recalled —
 * main is already spawning a runtime — so the agent it eventually produces has
 * to be recognised and discarded on arrival instead of appearing as a row the
 * user explicitly threw away.
 *
 * Recognition is deliberately not consume-once. A single launch reaches the
 * arrival handler twice: once from the `agent:launched` broadcast and once from
 * the fallback that covers a broadcast arriving before the listener attached. A
 * check that forgot the launch after the first call would let the second insert
 * the very row the user dismissed.
 */
export class AbandonedLaunches {
  private launchIds = new BoundedSet(64)
  private agentIds = new BoundedSet(64)

  abandon(launchId: string): void {
    this.launchIds.add(launchId)
  }

  /**
   * Classifies an arrival against the dismissed launches. Matches on the resolved
   * agent id too, so repeat arrivals are recognised even when they carry no
   * launchId. The 'first'/'again' split lets the caller clean up main-side state
   * exactly once.
   */
  recognise(launchId: string | undefined, agentId: string): 'live' | 'first' | 'again' {
    if (this.agentIds.has(agentId)) return 'again'
    if (launchId && this.launchIds.has(launchId)) {
      this.agentIds.add(agentId)
      return 'first'
    }
    return 'live'
  }
}

/** What to do with an incoming launched-agent notification. */
export type ArrivalPlan =
  /** The user dismissed this launch. `teardown` asks main to remove the agent it
   *  created, and is set on only one of the repeat arrivals. */
  | { action: 'drop'; teardown: boolean }
  /** Insert the agent, first retiring the placeholder at `retirePlaceholderId`. */
  | { action: 'insert'; retirePlaceholderId?: string }

/**
 * Decides what an arrival means. Split out from the store because the same launch
 * arrives twice — once on the `agent:launched` broadcast, once from the fallback
 * covering a broadcast that beat the listener — and getting that wrong either
 * duplicates the row or resurrects a dismissed one, neither of which is visible
 * from reading the handler.
 */
export function planArrival(
  payload: { id: string; launchId?: string },
  abandoned: AbandonedLaunches,
  isPendingPlaceholder: (id: string) => boolean
): ArrivalPlan {
  const recognised = abandoned.recognise(payload.launchId, payload.id)
  if (recognised !== 'live') {
    return { action: 'drop', teardown: recognised === 'first' }
  }

  // Main echoes the launchId back verbatim, so confirm the row really is this
  // renderer's placeholder before retiring it — a colliding id would otherwise
  // wipe a live agent's messages and events.
  const retirePlaceholderId =
    payload.launchId && isPendingPlaceholder(payload.launchId) ? payload.launchId : undefined
  return { action: 'insert', retirePlaceholderId }
}

export interface WorktreeRef {
  repoRoot: string
  worktreePath: string
}

/**
 * A launch's worktree ownership, tracked separately from the placeholder row
 * because the row can disappear while the launch is still running.
 */
export type LaunchCleanup =
  /** Launch in flight, row on screen. */
  | { phase: 'live'; worktree?: WorktreeRef }
  /** Row dismissed, launch still in flight. Outcome decides who cleans up. */
  | { phase: 'dismissed'; worktree?: WorktreeRef }
  /** Launch failed, row still on screen showing why. */
  | { phase: 'failed'; worktree?: WorktreeRef }
  /** Ownership settled; nothing further to do. */
  | { phase: 'settled' }

export type LaunchEvent =
  | { type: 'worktree-created'; worktree: WorktreeRef }
  | { type: 'dismissed' }
  | { type: 'failed' }
  | { type: 'succeeded' }

export type LaunchEffect =
  /** No agent will ever own this directory; delete it. */
  | { type: 'remove-worktree'; worktree: WorktreeRef }
  /** An agent exists, so main owns the worktree and removes it with the agent. */
  | { type: 'release-to-main' }

/**
 * Decides who deletes a worktree created for a launch, given that the four
 * things that settle it — the worktree appearing, the user dismissing the row,
 * the launch failing, and the launch succeeding — arrive in any order.
 *
 * This lives here as a reducer rather than as branches in the store because the
 * rule is not obvious and has been wrong three times: the dismiss handler can't
 * decide anything on its own, since a dismissal usually lands while the launch
 * is still running and only the outcome says whether an agent will ever exist to
 * own the directory. Dismissing during `git worktree add` is the case that keeps
 * getting missed — the row is gone before the path is even known, so the record
 * has to outlive it.
 */
export function advanceLaunchCleanup(
  state: LaunchCleanup,
  event: LaunchEvent
): { state: LaunchCleanup; effect?: LaunchEffect } {
  if (state.phase === 'settled') return { state }

  switch (event.type) {
    case 'worktree-created':
      // Recorded whatever the row is doing, including after a dismissal — this is
      // the ordering that used to strand the directory.
      return { state: { ...state, worktree: event.worktree } }

    case 'dismissed':
      // A dismissal after the failure is the last word: the launch already
      // resolved without producing an agent, so nothing else will claim it.
      if (state.phase === 'failed') {
        return state.worktree
          ? { state: { phase: 'settled' }, effect: { type: 'remove-worktree', worktree: state.worktree } }
          : { state: { phase: 'settled' } }
      }
      return { state: { phase: 'dismissed', worktree: state.worktree } }

    case 'failed':
      // While the row is still on screen it keeps its worktree: the user can see
      // the failure and may yet dismiss it.
      if (state.phase !== 'dismissed') return { state: { phase: 'failed', worktree: state.worktree } }
      return state.worktree
        ? { state: { phase: 'settled' }, effect: { type: 'remove-worktree', worktree: state.worktree } }
        : { state: { phase: 'settled' } }

    case 'succeeded':
      // An agent exists either way, so main owns the directory from here.
      return state.phase === 'dismissed'
        ? { state: { phase: 'settled' }, effect: { type: 'release-to-main' } }
        : { state: { phase: 'settled' } }
  }
}
