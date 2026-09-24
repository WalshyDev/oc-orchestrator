import { describe, it, expect } from 'vitest'
import {
  applyConfiguredModel,
  applyObservedResponse,
  applyObservedModel,
  formatModelName,
  getAgentModelState,
  refreshEffectiveVariant,
  resetObservedResponse
} from '../renderer/src/hooks/useAgentStore'
import { getDisplayedModel } from '../renderer/src/types'

describe('formatModelName', () => {
  describe('Claude models', () => {
    it('extracts family and major version from full model ID', () => {
      expect(formatModelName('claude-sonnet-4-20250514')).toBe('sonnet-4')
      expect(formatModelName('claude-opus-4-20250515')).toBe('opus-4')
      expect(formatModelName('claude-haiku-3-20240307')).toBe('haiku-3')
    })

    it('distinguishes minor versions from date suffixes', () => {
      expect(formatModelName('claude-opus-4-5-20250630')).toBe('opus-4.5')
      expect(formatModelName('claude-sonnet-4-1-20250601')).toBe('sonnet-4.1')
    })

    it('handles provider-prefixed model IDs', () => {
      expect(formatModelName('anthropic/claude-sonnet-4-20250514')).toBe('sonnet-4')
      expect(formatModelName('anthropic/claude-opus-4-5-20250630')).toBe('opus-4.5')
    })

    it('handles bare family-version strings', () => {
      expect(formatModelName('sonnet-4')).toBe('sonnet-4')
      expect(formatModelName('opus-4')).toBe('opus-4')
    })
  })

  describe('GPT models', () => {
    it('extracts gpt model names', () => {
      expect(formatModelName('gpt-4-turbo')).toBe('gpt-4-turbo')
      expect(formatModelName('gpt-4o')).toBe('gpt-4o')
      expect(formatModelName('gpt-4o-mini')).toBe('gpt-4o-mini')
    })
  })

  describe('OpenAI o-series', () => {
    it('extracts o-series model names', () => {
      expect(formatModelName('o1-preview')).toBe('o1-preview')
      expect(formatModelName('o1-mini')).toBe('o1-mini')
      expect(formatModelName('o3')).toBe('o3')
    })
  })

  describe('Gemini models', () => {
    it('extracts gemini model names', () => {
      expect(formatModelName('gemini-1.5-pro')).toBe('gemini-1.5-pro')
      expect(formatModelName('gemini-2.0-flash')).toBe('gemini-2.0-flash')
    })
  })

  describe('unknown models', () => {
    it('returns short names as-is', () => {
      expect(formatModelName('some-model')).toBe('some-model')
    })

    it('truncates long unknown names to 16 chars', () => {
      expect(formatModelName('very-long-unknown-model-name-here')).toBe('very-long-unknow')
    })
  })
})

describe('getDisplayedModel', () => {
  it('shows the configured next model and effort', () => {
    expect(getDisplayedModel({
      model: 'gpt-5.6-sol',
      configuredModel: 'gpt-5.6-luna',
      variant: 'max'
    })).toBe('gpt-5.6-luna (Max)')
  })

  it('omits provider-default effort', () => {
    expect(getDisplayedModel({ model: 'gpt-5.6-luna' })).toBe('gpt-5.6-luna')
    expect(getDisplayedModel({ model: 'gpt-5.6-luna', variant: 'auto' })).toBe('gpt-5.6-luna')
  })
})

describe('applyConfiguredModel', () => {
  it('uses the configured model until an assistant response identifies the active model', () => {
    const agent = { model: 'Loading...' }

    applyConfiguredModel(agent, 'openai/gpt-5.6-sol')
    expect(agent.model).toBe('gpt-5.6-sol')

    applyObservedModel(agent, 'claude-sonnet-5')
    applyConfiguredModel(agent, 'openai/gpt-5.6-sol')

    expect(agent).toEqual({
      model: 'sonnet-5',
      configuredModel: 'gpt-5.6-sol',
      configuredModelPath: 'openai/gpt-5.6-sol',
      rawModelId: 'claude-sonnet-5'
    })
  })

  it('preserves the observed model across reconnects', () => {
    const modelState = getAgentModelState(
      { model: 'sonnet-5', rawModelId: 'claude-sonnet-5' },
      'gpt-5.6-sol'
    )

    applyConfiguredModel(modelState, 'openai/gpt-5.6-sol')

    expect(modelState.model).toBe('sonnet-5')
    expect(modelState.rawModelId).toBe('claude-sonnet-5')
  })
})

describe('effective response variant', () => {
  const providers = {
    providers: [{
      id: 'openai',
      name: 'OpenAI',
      models: {
        'gpt-5.6-luna': {
          id: 'gpt-5.6-luna',
          name: 'GPT-5.6 Luna',
          options: { reasoningEffort: 'max' },
          variants: { max: { reasoningEffort: 'max' } }
        }
      }
    }]
  }

  it('does not let delayed history replace a newer live response', () => {
    const agent = {
      id: 'agent-1',
      model: 'gpt-5.6-luna',
      configuredModelPath: 'openai/gpt-5.6-luna',
      variant: 'max',
      rawModelId: 'gpt-5.6-luna',
      rawProviderId: 'openai',
      rawMessageVariant: 'max',
      observedModelAt: 200
    }

    expect(applyObservedResponse(agent, 'claude-sonnet-5', 'anthropic', 'high', 100)).toBe(false)
    expect(agent).toMatchObject({
      model: 'gpt-5.6-luna',
      variant: 'max',
      rawModelId: 'gpt-5.6-luna',
      observedModelAt: 200
    })
  })

  it('clears response metadata when a session resets', () => {
    const agent = {
      id: 'agent-1',
      model: 'gpt-5.6-luna',
      configuredModelPath: 'openai/gpt-5.6-luna',
      variant: 'high',
      configuredVariant: 'max',
      rawModelId: 'claude-sonnet-5',
      rawProviderId: 'anthropic',
      rawMessageVariant: 'high',
      observedModelAt: 200
    }

    resetObservedResponse(agent)

    expect(agent).toMatchObject({ model: 'gpt-5.6-luna', variant: 'max' })
    expect(agent.rawModelId).toBeUndefined()
    expect(agent.rawProviderId).toBeUndefined()
    expect(agent.rawMessageVariant).toBeUndefined()
    expect(agent.observedModelAt).toBeUndefined()
  })

  it('waits for a model before applying a configured variant', () => {
    const agent = {
      id: 'agent-1',
      model: 'Loading...',
      variant: 'max',
      configuredVariant: 'max'
    }

    refreshEffectiveVariant(agent, providers)

    expect(agent.variant).toBe('none')
  })

  it('uses merged model effort when no explicit variant applies', () => {
    const agent = {
      id: 'agent-1',
      model: 'gpt-5.6-luna',
      configuredModelPath: 'openai/gpt-5.6-luna',
      variant: 'none'
    }

    refreshEffectiveVariant(agent, providers)

    expect(agent.variant).toBe('max')
  })
})
