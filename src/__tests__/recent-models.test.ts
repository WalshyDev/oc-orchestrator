import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import {
  prioritizeRecentOptions,
  recordRecentModel,
  RECENT_MODELS_STORAGE_KEY,
} from '../renderer/src/hooks/useRecentModels'
import { ModelSelectField } from '../renderer/src/components/ModelSelectField'

let storage: Map<string, string>
let events: EventTarget

function storedModels(): string[] {
  return JSON.parse(storage.get(RECENT_MODELS_STORAGE_KEY)!).map((entry: { model: string }) => entry.model)
}

beforeEach(() => {
  storage = new Map()
  events = new EventTarget()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  })
  vi.stubGlobal('window', events)
})

afterEach(() => vi.unstubAllGlobals())

describe('recent model selections', () => {
  it('persists the last five distinct models, moving a reused model to the front', () => {
    for (const model of ['openai/a', 'anthropic/a', 'openai/b', 'openai/c', 'openai/d', 'openai/e', 'anthropic/a']) {
      recordRecentModel(model)
    }
    expect(storedModels()).toEqual([
      'anthropic/a', 'openai/e', 'openai/d', 'openai/c', 'openai/b',
    ])
  })

  it('does not displace a model with System Default or an empty selection', () => {
    recordRecentModel('openai/a')
    recordRecentModel('auto')
    recordRecentModel(' ')
    expect(storedModels()).toEqual(['openai/a'])
  })

  it('recovers from corrupt or invalid stored history', () => {
    storage.set(RECENT_MODELS_STORAGE_KEY, 'not json')
    recordRecentModel('openai/a')
    expect(storedModels()).toEqual(['openai/a'])
    storage.set(RECENT_MODELS_STORAGE_KEY, '[null,"auto",3,"openai/b","openai/b"]')
    recordRecentModel('openai/c')
    expect(storedModels()).toEqual(['openai/c', 'openai/b'])
  })

  it('notifies open selectors even if storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('storage unavailable') },
      setItem: () => { throw new Error('storage unavailable') },
    })
    const listener = vi.fn()
    events.addEventListener('oc-orchestrator:recent-models-changed', listener)
    expect(() => recordRecentModel('openai/a')).not.toThrow()
    expect(listener).toHaveBeenCalledOnce()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    })
    recordRecentModel('openai/a')
  })

  it('keeps new selections when reads work but writes fail, then persists them on recovery', () => {
    storage.set(RECENT_MODELS_STORAGE_KEY, '["old/model"]')
    let writesFail = true
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (writesFail) throw new Error('quota exceeded')
        storage.set(key, value)
      },
    })
    recordRecentModel('openai/a')
    recordRecentModel('openai/b')
    writesFail = false
    recordRecentModel('openai/c')
    expect(storedModels()).toEqual([
      'openai/c', 'openai/b', 'openai/a', 'old/model',
    ])
  })

  it('seeds actual use by message time regardless of hydration order and ignores replayed events', () => {
    for (const [model, usedAt] of [
      ['openai/a', 300], ['openai/b', 100], ['anthropic/a', 200],
      ['openai/c', 400], ['openai/a', 50], ['openai/c', 400], ['openai/b', 500],
      ['openai/d', 250], ['openai/e', 150],
    ] as const) recordRecentModel(model, usedAt)
    const expected = ['openai/b', 'openai/c', 'openai/a', 'openai/d', 'anthropic/a']
    expect(storedModels()).toEqual(expected)
    recordRecentModel('openai/a', 300)
    expect(storedModels()).toEqual(expected)
  })

  it('migrates selection history without letting old runs displace new selections', () => {
    storage.set(RECENT_MODELS_STORAGE_KEY, '["openai/a","openai/b"]')
    recordRecentModel('anthropic/a', 100)
    recordRecentModel('openai/b')
    recordRecentModel('anthropic/b', 150)
    recordRecentModel('anthropic/c', 120)
    recordRecentModel('openai/c', 200)
    expect(storedModels()).toEqual(['openai/b', 'openai/c', 'anthropic/b', 'anthropic/c', 'anthropic/a'])
  })
})

describe('recent model priority', () => {
  const options = [
    { value: 'auto', label: 'System Default' },
    { value: 'openai/a', label: 'A' },
    { value: 'anthropic/a', label: 'A (Anthropic)' },
    { value: 'openai/b', label: 'B' },
  ]

  it('promotes available models in recency order without duplicates or unavailable entries', () => {
    const prioritized = prioritizeRecentOptions(options, ['missing/model', 'openai/b', 'anthropic/a'])
    expect(prioritized.map((option) => option.value)).toEqual([
      'openai/b', 'anthropic/a', 'auto', 'openai/a',
    ])
    expect(options[0].value).toBe('auto')
  })

  it('promotes only recent options that survived the normal search filter', () => {
    const matches = options.filter((option) => option.label.includes('A'))
    expect(prioritizeRecentOptions(matches, ['openai/b', 'anthropic/a']).map((option) => option.value))
      .toEqual(['anthropic/a', 'openai/a'])
    expect(prioritizeRecentOptions(options, ['openai/b'])[0].value).toBe('openai/b')
  })

  it('preserves the selected model label for the closed dropdown', () => {
    recordRecentModel('openai/b')
    const markup = renderToStaticMarkup(createElement(ModelSelectField, {
      value: 'auto', options, onChange: vi.fn(), searchable: true,
    }))
    expect(markup).toContain('System Default')
    expect(markup).not.toContain('Recently used')
  })
})
