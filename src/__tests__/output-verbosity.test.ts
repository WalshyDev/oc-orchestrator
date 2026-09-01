import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  loadSettings
} from '../renderer/src/data/settings'
import {
  AGENT_SETTINGS_STORAGE_KEY,
  loadAgentOutputVerbosity,
  saveAgentOutputVerbosity
} from '../renderer/src/data/agentSettings'

class MemoryStorage {
  private values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

describe('output verbosity settings', () => {
  let storage: MemoryStorage

  beforeEach(() => {
    storage = new MemoryStorage()
    vi.stubGlobal('localStorage', storage)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('migrates saved boolean verbosity without changing other settings', () => {
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
      model: 'openai/gpt-5',
      verboseMode: true
    }))

    const settings = loadSettings()

    expect(settings.model).toBe('openai/gpt-5')
    expect(settings.outputVerbosity).toBe('all')
    expect(settings).not.toHaveProperty('verboseMode')
  })

  it('maps a saved false value and new installs to None', () => {
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ verboseMode: false }))
    expect(loadSettings().outputVerbosity).toBe('none')

    storage = new MemoryStorage()
    vi.stubGlobal('localStorage', storage)
    expect(loadSettings().outputVerbosity).toBe(DEFAULT_SETTINGS.outputVerbosity)
  })

  it('stores output detail independently for each existing agent', () => {
    saveAgentOutputVerbosity('agent-one', 'some')
    saveAgentOutputVerbosity('agent-two', 'all')

    expect(loadAgentOutputVerbosity('agent-one')).toBe('some')
    expect(loadAgentOutputVerbosity('agent-two')).toBe('all')
    expect(loadAgentOutputVerbosity('existing-agent')).toBeUndefined()
    expect(storage.getItem(AGENT_SETTINGS_STORAGE_KEY)).toContain('agent-one')
  })
})
