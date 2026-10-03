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
  it('persists the last three distinct models, moving a reused model to the front', () => {
    for (const model of ['openai/a', 'anthropic/a', 'openai/b', 'openai/c', 'anthropic/a']) {
      recordRecentModel(model)
    }
    expect(JSON.parse(storage.get(RECENT_MODELS_STORAGE_KEY)!)).toEqual([
      'anthropic/a', 'openai/c', 'openai/b',
    ])
  })

  it('does not displace a model with System Default or an empty selection', () => {
    recordRecentModel('openai/a')
    recordRecentModel('auto')
    recordRecentModel(' ')
    expect(JSON.parse(storage.get(RECENT_MODELS_STORAGE_KEY)!)).toEqual(['openai/a'])
  })

  it('recovers from corrupt or invalid stored history', () => {
    storage.set(RECENT_MODELS_STORAGE_KEY, 'not json')
    recordRecentModel('openai/a')
    expect(JSON.parse(storage.get(RECENT_MODELS_STORAGE_KEY)!)).toEqual(['openai/a'])
    storage.set(RECENT_MODELS_STORAGE_KEY, '[null,"auto",3,"openai/b","openai/b"]')
    recordRecentModel('openai/c')
    expect(JSON.parse(storage.get(RECENT_MODELS_STORAGE_KEY)!)).toEqual(['openai/c', 'openai/b'])
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
    expect(JSON.parse(storage.get(RECENT_MODELS_STORAGE_KEY)!)).toEqual([
      'openai/c', 'openai/b', 'openai/a',
    ])
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
    const prioritized = prioritizeRecentOptions(options, ['missing/model', 'openai/b', 'anthropic/a'], '')
    expect(prioritized.map((option) => option.value)).toEqual([
      'openai/b', 'anthropic/a', 'auto', 'openai/a',
    ])
    expect(options[0].value).toBe('auto')
  })

  it('keeps normal search ordering and restores priority when the filter is cleared', () => {
    expect(prioritizeRecentOptions(options, ['openai/b'], 'A')).toBe(options)
    expect(prioritizeRecentOptions(options, ['openai/b'], '  ')[0].value).toBe('openai/b')
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
