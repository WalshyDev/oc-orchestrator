import { describe, it, expect } from 'vitest'
import {
  buildOptionsFromProviders,
  resolveSystemDefaultLabel,
  type ProviderData,
} from '../renderer/src/hooks/useModelOptions'

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
