import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  loadSettings
} from '../renderer/src/data/settings'
import {
  AGENT_SETTINGS_STORAGE_KEY,
  deleteAgentSettings,
  loadAgentAutoRecoverSetting,
  resolveAutoRecoverStalledResponses,
  saveAgentAutoRecoverSetting
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

describe('stalled response recovery settings', () => {
  let storage: MemoryStorage

  beforeEach(() => {
    storage = new MemoryStorage()
    vi.stubGlobal('localStorage', storage)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('defaults automatic recovery to off for new and existing settings', () => {
    expect(loadSettings().autoRecoverStalledResponses).toBe(false)

    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ model: 'openai/gpt-5' }))
    expect(loadSettings().autoRecoverStalledResponses).toBe(DEFAULT_SETTINGS.autoRecoverStalledResponses)
  })

  it('ignores malformed persisted recovery settings', () => {
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ autoRecoverStalledResponses: 'yes' }))
    storage.setItem(AGENT_SETTINGS_STORAGE_KEY, JSON.stringify({
      malformed: { autoRecoverStalledResponses: 'yes' },
      primitive: true
    }))

    expect(loadSettings().autoRecoverStalledResponses).toBe(false)
    expect(loadAgentAutoRecoverSetting('malformed')).toBe('inherit')
    expect(loadAgentAutoRecoverSetting('primitive')).toBe('inherit')
  })

  it('persists independent per-agent overrides', () => {
    saveAgentAutoRecoverSetting('agent-one', 'on')
    saveAgentAutoRecoverSetting('agent-two', 'off')

    expect(loadAgentAutoRecoverSetting('agent-one')).toBe('on')
    expect(loadAgentAutoRecoverSetting('agent-two')).toBe('off')
    expect(loadAgentAutoRecoverSetting('existing-agent')).toBe('inherit')
    expect(storage.getItem(AGENT_SETTINGS_STORAGE_KEY)).toContain('agent-one')
  })

  it('removes an inherited override without deleting other agent settings', () => {
    storage.setItem(AGENT_SETTINGS_STORAGE_KEY, JSON.stringify({
      agent: { outputVerbosity: 'some', autoRecoverStalledResponses: true }
    }))

    saveAgentAutoRecoverSetting('agent', 'inherit')

    expect(loadAgentAutoRecoverSetting('agent')).toBe('inherit')
    expect(storage.getItem(AGENT_SETTINGS_STORAGE_KEY)).toContain('outputVerbosity')
  })

  it('uses the per-agent setting before the global default', () => {
    expect(resolveAutoRecoverStalledResponses(false, 'inherit')).toBe(false)
    expect(resolveAutoRecoverStalledResponses(true, 'inherit')).toBe(true)
    expect(resolveAutoRecoverStalledResponses(false, 'on')).toBe(true)
    expect(resolveAutoRecoverStalledResponses(true, 'off')).toBe(false)
  })

  it('removes settings with a deleted agent', () => {
    saveAgentAutoRecoverSetting('deleted-agent', 'on')

    deleteAgentSettings('deleted-agent')

    expect(loadAgentAutoRecoverSetting('deleted-agent')).toBe('inherit')
    expect(storage.getItem(AGENT_SETTINGS_STORAGE_KEY)).not.toContain('deleted-agent')
  })
})
