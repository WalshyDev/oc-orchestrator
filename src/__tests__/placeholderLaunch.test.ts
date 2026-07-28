import { describe, it, expect } from 'vitest'
import {
  AbandonedLaunches,
  advanceLaunchCleanup,
  applyLaunchFailure,
  buildPlaceholderAgent,
  planArrival,
  predictPlaceholderName,
  type LaunchCleanup,
  type LaunchEvent
} from '../renderer/src/hooks/placeholderLaunch'
// The real derivation, not a copy: the placeholder's whole job is predicting the
// name the store will settle on, so a local reimplementation would drift and the
// tests would stop saying anything about that prediction.
import { deriveNameFromPrompt, type LiveAgent } from '../renderer/src/hooks/useAgentStore'

describe('predictPlaceholderName', () => {
  it('prefers an explicit title, matching upsertAgent for a user-set title', () => {
    const name = predictPlaceholderName(
      { directory: '/src/myrepo', title: 'Fix the parser', prompt: 'go fix the parser please' },
      deriveNameFromPrompt
    )
    // A supplied title means isAutoTitle is false, so main keeps the title
    // verbatim rather than deriving a name from the prompt.
    expect(name).toBe('Fix the parser')
  })

  it('derives from the prompt when no title was given', () => {
    const name = predictPlaceholderName(
      { directory: '/src/myrepo', prompt: 'Refactor the event bridge' },
      deriveNameFromPrompt
    )
    expect(name).toBe('refactor-the-event-bridge')
  })

  it('falls back to the project name when given neither', () => {
    expect(predictPlaceholderName({ directory: '/src/myrepo' }, deriveNameFromPrompt)).toBe('myrepo')
    expect(predictPlaceholderName({ directory: '/src/myrepo/' }, deriveNameFromPrompt)).toBe('myrepo')
  })

  it('truncates a long title to the 30 chars main keeps', () => {
    const name = predictPlaceholderName(
      { directory: '/src/myrepo', title: 'x'.repeat(50) },
      deriveNameFromPrompt
    )
    expect(name).toBe('x'.repeat(30))
  })

  it('treats a whitespace-only title as absent, matching what the modal sends', () => {
    // LaunchModal trims before handing the title over, so a blank one never
    // reaches main either — the prediction and the real name agree on the prompt.
    const name = predictPlaceholderName(
      { directory: '/src/myrepo', title: '   ', prompt: 'do the thing' },
      deriveNameFromPrompt
    )
    expect(name).toBe('do-the-thing')
  })
})

describe('buildPlaceholderAgent', () => {
  it('keys the synthetic session on the launch id so cleanup finds it', () => {
    const agent = buildPlaceholderAgent('pending-1', { directory: '/src/myrepo' }, deriveNameFromPrompt)
    expect(agent.id).toBe('pending-1')
    expect(agent.sessionId).toBe('pending-1')
    expect(agent.pending).toBe(true)
    expect(agent.status).toBe('starting')
  })

  it('shows the prompt as the task summary, truncated', () => {
    const long = 'a'.repeat(200)
    const agent = buildPlaceholderAgent('pending-1', { directory: '/src/r', prompt: long }, deriveNameFromPrompt)
    expect(agent.taskSummary).toHaveLength(120)
  })

  it('falls back to a placeholder summary with no prompt', () => {
    const agent = buildPlaceholderAgent('pending-1', { directory: '/src/r' }, deriveNameFromPrompt)
    expect(agent.taskSummary).toBe('Starting agent...')
  })
})

describe('applyLaunchFailure', () => {
  function placeholder(): LiveAgent {
    return buildPlaceholderAgent('pending-1', { directory: '/src/r' }, deriveNameFromPrompt)
  }

  it('surfaces the real cause in the row summary', () => {
    const agent = placeholder()
    applyLaunchFailure(agent, 'spawn opencode ENOENT')
    expect(agent.status).toBe('errored')
    expect(agent.taskSummary).toBe('Launch failed: spawn opencode ENOENT')
    expect(agent.lastError?.message).toBe('spawn opencode ENOENT')
  })

  it('still explains itself when no message was available', () => {
    const agent = placeholder()
    applyLaunchFailure(agent, '')
    expect(agent.taskSummary).toBe('Launch failed')
  })
})

describe('AbandonedLaunches', () => {
  it('keeps recognising a dismissed launch across repeat arrivals', () => {
    // The arrival handler runs twice per launch (broadcast + post-invoke
    // fallback). Forgetting after the first call lets the second insert the row
    // the user dismissed.
    const abandoned = new AbandonedLaunches()
    abandoned.abandon('pending-1')
    expect(abandoned.recognise('pending-1', 'agent-7')).toBe('first')
    expect(abandoned.recognise('pending-1', 'agent-7')).toBe('again')
  })

  it('recognises a repeat arrival that carries no launch id', () => {
    // The fallback path can resolve without a launchId; matching on the agent id
    // is what catches it.
    const abandoned = new AbandonedLaunches()
    abandoned.abandon('pending-1')
    expect(abandoned.recognise('pending-1', 'agent-7')).toBe('first')
    expect(abandoned.recognise(undefined, 'agent-7')).toBe('again')
  })

  it('reports only the first recognition, so teardown fires once', () => {
    const abandoned = new AbandonedLaunches()
    abandoned.abandon('pending-1')
    const outcomes = [
      abandoned.recognise('pending-1', 'agent-7'),
      abandoned.recognise('pending-1', 'agent-7'),
      abandoned.recognise(undefined, 'agent-7')
    ]
    expect(outcomes.filter((o) => o === 'first')).toHaveLength(1)
  })

  it('leaves launches that were never dismissed alone', () => {
    const abandoned = new AbandonedLaunches()
    expect(abandoned.recognise('pending-1', 'agent-7')).toBe('live')
  })

  it('does not treat an unrelated agent as dismissed just because a launch was', () => {
    // Agents launched elsewhere carry no launchId; matching loosely would discard
    // them.
    const abandoned = new AbandonedLaunches()
    abandoned.abandon('pending-1')
    expect(abandoned.recognise(undefined, 'agent-9')).toBe('live')
    expect(abandoned.recognise('pending-2', 'agent-9')).toBe('live')
  })

  it('tracks several dismissed launches independently', () => {
    const abandoned = new AbandonedLaunches()
    abandoned.abandon('pending-1')
    abandoned.abandon('pending-2')
    expect(abandoned.recognise('pending-2', 'agent-8')).toBe('first')
    expect(abandoned.recognise('pending-1', 'agent-7')).toBe('first')
  })

  it('stops tracking the oldest dismissals rather than growing without bound', () => {
    const abandoned = new AbandonedLaunches()
    for (let i = 0; i < 70; i++) abandoned.abandon(`pending-${i}`)
    // The 64-entry cap evicts oldest-first; recent dismissals are what matter,
    // since an in-flight launch resolves within seconds.
    expect(abandoned.recognise('pending-0', 'agent-0')).toBe('live')
    expect(abandoned.recognise('pending-69', 'agent-69')).toBe('first')
  })
})

describe('planArrival', () => {
  const arrival = { id: 'agent-7', launchId: 'pending-1' }

  /** Every launch is announced twice: once by the broadcast, once by the fallback
   *  that covers a broadcast arriving before the listener attached. */
  function bothArrivals(
    abandoned: AbandonedLaunches,
    pendingIds: Set<string>
  ): ReturnType<typeof planArrival>[] {
    const isPending = (id: string): boolean => pendingIds.has(id)
    const first = planArrival(arrival, abandoned, isPending)
    // The store retires the placeholder after the first insert.
    if (first.action === 'insert' && first.retirePlaceholderId) pendingIds.delete(first.retirePlaceholderId)
    return [first, planArrival(arrival, abandoned, isPending)]
  }

  it('inserts once and retires the placeholder exactly once', () => {
    const [first, second] = bothArrivals(new AbandonedLaunches(), new Set(['pending-1']))
    expect(first).toEqual({ action: 'insert', retirePlaceholderId: 'pending-1' })
    // The second arrival must not repeat the destructive retire; the store's own
    // has-the-agent check keeps it from double-inserting.
    expect(second).toEqual({ action: 'insert', retirePlaceholderId: undefined })
  })

  it('drops both arrivals of a dismissed launch, tearing down once', () => {
    // The regression this guards: recognising the dismissal only once let the
    // second arrival insert the row the user had just thrown away.
    const abandoned = new AbandonedLaunches()
    abandoned.abandon('pending-1')
    const plans = bothArrivals(abandoned, new Set())
    expect(plans.every((p) => p.action === 'drop')).toBe(true)
    expect(plans.filter((p) => p.action === 'drop' && p.teardown)).toHaveLength(1)
  })

  it('drops a repeat arrival that carries no launch id', () => {
    const abandoned = new AbandonedLaunches()
    abandoned.abandon('pending-1')
    expect(planArrival(arrival, abandoned, () => false)).toEqual({ action: 'drop', teardown: true })
    expect(planArrival({ id: 'agent-7' }, abandoned, () => false)).toEqual({ action: 'drop', teardown: false })
  })

  it('does not retire a live agent whose id collides with the launch id', () => {
    // Main echoes launchId back verbatim; retiring without confirming the row is
    // a placeholder would wipe a real agent's messages and events.
    const plan = planArrival(arrival, new AbandonedLaunches(), () => false)
    expect(plan).toEqual({ action: 'insert', retirePlaceholderId: undefined })
  })

  it('inserts agents launched elsewhere, which carry no launch id', () => {
    const plan = planArrival({ id: 'agent-9' }, new AbandonedLaunches(), () => false)
    expect(plan).toEqual({ action: 'insert', retirePlaceholderId: undefined })
  })
})

describe('advanceLaunchCleanup', () => {
  const worktree = { repoRoot: '/repo', worktreePath: '/repo/../wt-1' }

  /** Replays a launch's events and reports every cleanup effect they produced. */
  function replay(events: LaunchEvent[]): ReturnType<typeof advanceLaunchCleanup>['effect'][] {
    let state: LaunchCleanup = { phase: 'live' }
    const effects: ReturnType<typeof advanceLaunchCleanup>['effect'][] = []
    for (const event of events) {
      const result = advanceLaunchCleanup(state, event)
      state = result.state
      if (result.effect) effects.push(result.effect)
    }
    return effects
  }

  const created: LaunchEvent = { type: 'worktree-created', worktree }
  const remove = { type: 'remove-worktree', worktree }
  const release = { type: 'release-to-main' }

  it('removes the worktree when a dismissed launch then fails', () => {
    expect(replay([created, { type: 'dismissed' }, { type: 'failed' }])).toEqual([remove])
  })

  it('removes the worktree when a failed launch is then dismissed', () => {
    // Same two facts in the other order: the user reads the error, then clears it.
    expect(replay([created, { type: 'failed' }, { type: 'dismissed' }])).toEqual([remove])
  })

  it('removes the worktree when the row is dismissed before the worktree exists', () => {
    // `git worktree add` is slow enough to dismiss during, and the path isn't
    // known until it returns. Losing the record here was the original leak.
    expect(replay([{ type: 'dismissed' }, created, { type: 'failed' }])).toEqual([remove])
  })

  it('leaves the worktree to main when a dismissed launch succeeds', () => {
    // An agent exists, so removing the directory here would race main's teardown.
    expect(replay([created, { type: 'dismissed' }, { type: 'succeeded' }])).toEqual([release])
  })

  it('leaves the worktree to main when dismissal precedes both the path and success', () => {
    expect(replay([{ type: 'dismissed' }, created, { type: 'succeeded' }])).toEqual([release])
  })

  it('does nothing while a failed launch still has a row on screen', () => {
    // The row shows the error and still owns its worktree; the user may retry or
    // inspect it before dismissing.
    expect(replay([created, { type: 'failed' }])).toEqual([])
  })

  it('does nothing when a launch simply succeeds', () => {
    expect(replay([created, { type: 'succeeded' }])).toEqual([])
  })

  it('does not remove a worktree that was never created', () => {
    expect(replay([{ type: 'dismissed' }, { type: 'failed' }])).toEqual([])
  })

  it('emits at most one effect however many times the outcome is reported', () => {
    // The arrival handler runs twice per launch, and a failure can follow a
    // dismissal that already settled ownership.
    expect(replay([created, { type: 'dismissed' }, { type: 'succeeded' }, { type: 'succeeded' }])).toEqual([release])
    expect(replay([created, { type: 'dismissed' }, { type: 'failed' }, { type: 'failed' }])).toEqual([remove])
    expect(replay([created, { type: 'dismissed' }, { type: 'failed' }, { type: 'succeeded' }])).toEqual([remove])
  })

  it('ignores a repeat dismissal', () => {
    expect(replay([created, { type: 'dismissed' }, { type: 'dismissed' }, { type: 'failed' }])).toEqual([remove])
  })
})
