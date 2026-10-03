import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadSettings, SETTINGS_STORAGE_KEY } from '../renderer/src/data/settings'

describe('launch model settings', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads the configured provider/model and variant', () => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => {
        if (key !== SETTINGS_STORAGE_KEY) return null
        return JSON.stringify({ model: 'anthropic/claude-sonnet-4-20250514', modelVariant: 'high' })
      }
    })

    const { model, modelVariant } = loadSettings()

    expect({ model, modelVariant }).toEqual({
      model: 'anthropic/claude-sonnet-4-20250514',
      modelVariant: 'high'
    })
  })
})
