import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildOptionsFromProviders,
  ensureProvidersLoaded,
  getVariantOptionsForModel,
  invalidateProviderCache,
  resolveEffectiveVariant,
  resolveSystemDefaultLabel,
  subscribeToConfigChanges,
  type ProviderData,
} from '../renderer/src/hooks/useModelOptions'

afterEach(() => {
  invalidateProviderCache()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('buildOptionsFromProviders', () => {
  it('always includes System Default as the first option', () => {
    const data: ProviderData = { providers: [] }
    const options = buildOptionsFromProviders(data)
    expect(options).toHaveLength(1)
    expect(options[0]).toEqual({ value: 'auto', label: 'System Default' })
  })

  it('builds provider/model options from provider data', () => {
    const data: ProviderData = {
      providers: [
        {
          id: 'anthropic',
          name: 'Anthropic',
          models: {
            'claude-sonnet-4-20250514': { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
          },
        },
      ],
    }

    const options = buildOptionsFromProviders(data)
    expect(options).toHaveLength(2)
    expect(options[1]).toEqual({
      value: 'anthropic/claude-sonnet-4-20250514',
      label: 'Claude Sonnet 4  (Anthropic)',
    })
  })

  it('sorts providers alphabetically', () => {
    const data: ProviderData = {
      providers: [
        {
          id: 'openai',
          name: 'OpenAI',
          models: { 'gpt-4o': { id: 'gpt-4o', name: 'GPT-4o' } },
        },
        {
          id: 'anthropic',
          name: 'Anthropic',
          models: { 'claude-sonnet-4-20250514': { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' } },
        },
      ],
    }

    const options = buildOptionsFromProviders(data)
    // Anthropic sorts before OpenAI
    expect(options[1].label).toContain('Anthropic')
    expect(options[2].label).toContain('OpenAI')
  })

  it('filters out providers with no models', () => {
    const data: ProviderData = {
      providers: [
        { id: 'empty', name: 'Empty Provider', models: {} },
        {
          id: 'anthropic',
          name: 'Anthropic',
          models: { 'claude-opus-4-20250515': { id: 'claude-opus-4-20250515', name: 'Claude Opus 4' } },
        },
      ],
    }

    const options = buildOptionsFromProviders(data)
    expect(options).toHaveLength(2) // System Default + one model
    expect(options.every((o) => !o.label.includes('Empty'))).toBe(true)
  })
})

describe('getVariantOptionsForModel', () => {
  it('keeps the selected effort when provider metadata is unavailable', () => {
    expect(getVariantOptionsForModel('opencode/luna', null, undefined, 'max')).toEqual([
      { value: 'auto', label: 'Provider Default' },
      { value: 'max', label: 'Max' },
    ])
  })
})

describe('resolveEffectiveVariant', () => {
  const model = {
    id: 'gpt-6-luna',
    name: 'GPT-6 Luna',
    options: { reasoningEffort: 'max' },
    variants: {
      high: { reasoningEffort: 'high' },
      max: { reasoningEffort: 'max' },
    },
  }

  it('prefers the variant recorded on the message', () => {
    expect(resolveEffectiveVariant('low', 'high', model)).toBe('low')
  })

  it('uses the configured variant when the message omits one', () => {
    expect(resolveEffectiveVariant(undefined, 'high', model)).toBe('high')
  })

  it('matches merged model reasoning effort when no explicit variant applies', () => {
    expect(resolveEffectiveVariant(undefined, undefined, model)).toBe('max')
  })

  it('returns none when merged model options do not match a variant', () => {
    expect(resolveEffectiveVariant(undefined, undefined, {
      ...model,
      options: { reasoningEffort: 'custom' },
    })).toBe('none')
  })

  it('returns none when the model has no reasoning effort', () => {
    expect(resolveEffectiveVariant(undefined, undefined, {
      ...model,
      options: {},
    })).toBe('none')
  })
})

describe('resolveSystemDefaultLabel', () => {
  const providers: ProviderData = {
    providers: [
      {
        id: 'anthropic',
        name: 'Anthropic',
        models: {
          'claude-sonnet-4-20250514': { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
          'claude-opus-4-20250515': { id: 'claude-opus-4-20250515', name: 'Claude Opus 4' },
        },
      },
      {
        id: 'openai',
        name: 'OpenAI',
        models: {
          'gpt-4o': { id: 'gpt-4o', name: 'GPT-4o' },
        },
      },
    ],
  }

  it('returns plain label when config model is undefined', () => {
    expect(resolveSystemDefaultLabel(undefined, providers)).toBe('System Default')
  })

  it('returns plain label when config model is undefined and no providers', () => {
    expect(resolveSystemDefaultLabel(undefined, null)).toBe('System Default')
  })

  it('resolves provider/model format to friendly name from provider data', () => {
    expect(resolveSystemDefaultLabel('anthropic/claude-sonnet-4-20250514', providers))
      .toBe('System Default (Claude Sonnet 4)')
  })

  it('resolves bare model ID from provider data', () => {
    expect(resolveSystemDefaultLabel('gpt-4o', providers))
      .toBe('System Default (GPT-4o)')
  })

  it('falls back to formatModelName when model not found in providers', () => {
    expect(resolveSystemDefaultLabel('anthropic/claude-haiku-3-20240307', providers))
      .toBe('System Default (haiku-3)')
  })

  it('falls back to formatModelName when no providers available', () => {
    expect(resolveSystemDefaultLabel('anthropic/claude-opus-4-5-20250630', null))
      .toBe('System Default (opus-4.5)')
  })

  it('handles unknown model with no providers', () => {
    expect(resolveSystemDefaultLabel('my-model', null))
      .toBe('System Default (my-model)')
  })

  it('truncates long unknown model names via formatModelName', () => {
    expect(resolveSystemDefaultLabel('very-long-unknown-model-name', null))
      .toBe('System Default (very-long-unknow)')
  })
})

describe('getVariantOptionsForModel', () => {
  const providers: ProviderData = {
    providers: [
      {
        id: 'openai',
        name: 'OpenAI',
        models: {
          'shared-model': {
            id: 'shared-model',
            name: 'Shared Model',
            variants: { low: {}, high: {}, fast: {}, 'custom-speed': {} },
          },
          'vendor/nested-model': {
            id: 'vendor/nested-model',
            name: 'Nested Model',
            variants: { turbo: {} },
          },
          'no-variants': { id: 'no-variants', name: 'No Variants' },
        },
      },
      {
        id: 'other',
        name: 'Other',
        models: {
          'shared-model': {
            id: 'shared-model',
            name: 'Other Shared Model',
            variants: { balanced: {} },
          },
        },
      },
    ],
  }

  it.each([
    ['openai/shared-model', undefined, ['auto', 'low', 'high', 'fast', 'custom-speed']],
    ['other/shared-model', undefined, ['auto', 'balanced']],
    ['openai/vendor/nested-model', undefined, ['auto', 'turbo']],
    ['auto', 'openai/shared-model', ['auto', 'low', 'high', 'fast', 'custom-speed']],
    ['openai/no-variants', undefined, ['auto']],
    ['unknown/model', undefined, ['auto']],
    ['auto', undefined, ['auto']],
  ])('lists only variants of %s (default %s)', (model, configModel, expected) => {
    expect(getVariantOptionsForModel(model, providers, configModel).map(({ value }) => value)).toEqual(expected)
  })
})

describe('ensureProvidersLoaded', () => {
  it('uses fresh project metadata instead of the global cache when a directory is selected', async () => {
    const globalProviders: ProviderData = { providers: [] }
    const projectProviders: ProviderData = {
      providers: [{
        id: 'custom',
        name: 'Custom',
        models: { model: { id: 'model', name: 'Model', variants: { fast: {} } } },
      }],
    }
    const listAllProviders = vi.fn().mockImplementation(async (directory?: string) => ({
      ok: true,
      data: directory ? projectProviders : globalProviders,
    }))
    const getSystemConfig = vi.fn().mockResolvedValue({ ok: true, data: { model: 'custom/model' } })
    vi.stubGlobal('window', { api: { listAllProviders, getSystemConfig } })

    await ensureProvidersLoaded()
    const project = await ensureProvidersLoaded('/tmp/selected-project')
    expect(listAllProviders).toHaveBeenLastCalledWith('/tmp/selected-project')
    expect(getSystemConfig).toHaveBeenLastCalledWith('/tmp/selected-project')
    expect(getVariantOptionsForModel('auto', project.providerData, project.configModel)).toEqual([
      { value: 'auto', label: 'Provider Default' },
      { value: 'fast', label: 'Fast' },
    ])

    await ensureProvidersLoaded('/tmp/selected-project')
    expect(listAllProviders).toHaveBeenCalledTimes(3)
    expect((await ensureProvidersLoaded()).providerData).toBe(globalProviders)
    expect(listAllProviders).toHaveBeenCalledTimes(3)
  })

  it('notifies open model selectors when metadata becomes available after a cold-start retry', async () => {
    vi.useFakeTimers()
    const listAllProviders = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: null })
      .mockResolvedValue({ ok: true, data: { providers: [] } })
    vi.stubGlobal('window', {
      api: {
        listAllProviders,
        getSystemConfig: vi.fn().mockResolvedValue({ ok: true, data: {} }),
      },
    })
    const listener = vi.fn()
    const unsubscribe = subscribeToConfigChanges(listener)
    try {
      expect((await ensureProvidersLoaded()).providerData).toBeNull()
      await vi.advanceTimersByTimeAsync(500)
      expect(listener).toHaveBeenCalledOnce()
      expect(listAllProviders).toHaveBeenCalledTimes(2)
    } finally {
      unsubscribe()
    }
  })

  it('fetches system config fresh while reusing cached provider data', async () => {
    const listAllProviders = vi.fn().mockResolvedValue({
      ok: true,
      data: { providers: [] },
    })
    const getSystemConfig = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: { model: 'anthropic/claude-opus-4-7' } })
      .mockResolvedValueOnce({ ok: true, data: { model: 'anthropic/claude-opus-4-8' } })

    vi.stubGlobal('window', {
      api: {
        listAllProviders,
        getSystemConfig,
      },
    })

    const first = await ensureProvidersLoaded()
    const second = await ensureProvidersLoaded()

    expect(first.configModel).toBe('anthropic/claude-opus-4-7')
    expect(second.configModel).toBe('anthropic/claude-opus-4-8')
    expect(listAllProviders).toHaveBeenCalledOnce()
    expect(getSystemConfig).toHaveBeenCalledTimes(2)
  })
})
