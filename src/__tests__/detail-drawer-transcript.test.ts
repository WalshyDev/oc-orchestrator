import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DetailDrawer } from '../renderer/src/components/DetailDrawer'
import { getAssistantResponseMetadata, getMessageModelId } from '../renderer/src/hooks/useAgentStore'
import { buildToolGroupMessage } from '../renderer/src/lib/transcript-metadata'
import type { AgentRuntime } from '../renderer/src/types'
import type { LiveMessage } from '../renderer/src/hooks/useAgentStore'
import type { ToolCall } from '../renderer/src/components/ToolsUsage'
import { splitTaskToolGroups } from '../renderer/src/lib/subagent-progress'

const agent: AgentRuntime = {
  id: 'agent-1',
  sessionId: 'session-1',
  name: 'Agent 1',
  projectId: 'project-1',
  projectName: 'Project',
  branchName: 'branch',
  isWorktree: true,
  workspaceName: 'workspace',
  taskSummary: 'Task',
  status: 'idle',
  labelIds: [],
  model: 'agent-current-model',
  prUrl: null,
  lastActivityAt: 'now',
  lastActivityAtMs: 1
}

describe('DetailDrawer transcript metadata', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps group ids when tool messages arrive or a task splits the group', () => {
    const anchor: LiveMessage = {
      id: 'first', role: 'assistant', sessionId: 'session', createdAt: 1, parts: []
    }
    const tool: ToolCall = { id: 'read', name: 'read', state: 'completed', timestamp: 1 }
    const later: ToolCall = { id: 'task', name: 'task', state: 'running', timestamp: 2 }
    const first = buildToolGroupMessage(anchor, [tool], 'now')
    const joined = buildToolGroupMessage({ ...anchor, id: 'second', createdAt: 2 }, [tool, later], 'now')

    expect(first.id).toBe(joined.id)
    expect(splitTaskToolGroups(joined)[0].id).toBe(first.id)
    expect(joined.activityAt).toBe(2)
  })

  it('preserves authoritative assistant response metadata', () => {
    const info = {
      role: 'assistant',
      providerID: 'opencode',
      modelID: 'luna',
      variant: 'max'
    } as const

    expect(getMessageModelId(info)).toBe('luna')
    expect(getAssistantResponseMetadata(info)).toEqual({
      providerID: 'opencode',
      variant: 'max'
    })

    expect(getAssistantResponseMetadata({
      role: 'user',
      providerID: 'untrusted',
      modelID: 'untrusted',
      variant: 'untrusted'
    })).toEqual({})
  })

  it.each([
    { variant: 'max', expectedEffort: 'Max' },
    { variant: 'auto', expectedEffort: undefined },
    { variant: undefined, expectedEffort: undefined }
  ])('renders provider, model, and $expectedEffort effort on agent messages', ({ variant, expectedEffort }) => {
    vi.stubGlobal('window', { innerHeight: 1000 })
    vi.stubGlobal('localStorage', { getItem: () => null })

    const markup = renderToStaticMarkup(createElement(DetailDrawer, {
      agent,
      messages: [{
        id: 'message-1',
        role: 'assistant',
        content: 'Response text',
        timestamp: 'now',
        providerID: 'opencode',
        model: 'luna',
        variant
      }],
      onClose: () => {}
    }))

    expect(markup).toContain('opencode')
    expect(markup).toContain('luna')
    if (expectedEffort) {
      expect(markup).toContain(`Effort: ${expectedEffort}`)
    } else {
      expect(markup).not.toContain('Effort:')
    }
  })

  it('renders response metadata for tool-only assistant turns', () => {
    vi.stubGlobal('window', { innerHeight: 1000 })
    vi.stubGlobal('localStorage', { getItem: () => null })

    const markup = renderToStaticMarkup(createElement(DetailDrawer, {
      agent,
      messages: [buildToolGroupMessage(
        {
          id: 'message-1',
          createdAt: 1,
          providerID: 'response-provider',
          modelId: 'response-model',
          variant: 'max',
          role: 'assistant',
          sessionId: 'session-1',
          parts: [{ id: 'tool-part-1', type: 'tool', toolName: 'read' }]
        },
        [{
          id: 'tool-1',
          name: 'read',
          state: 'completed',
          timestamp: 1,
          model: 'response-model',
          providerID: 'response-provider',
          variant: 'max'
        }],
        'now'
      )],
      onClose: () => {}
    }))

    expect(markup).toContain('response-provider')
    expect(markup).toContain('response-model')
    expect(markup).toContain('Effort: Max')
    expect(markup).toMatch(/class="[^"]*text-\[10px\][^"]*">response-provider · response-model · Effort: Max<\/span>/)
  })
})
