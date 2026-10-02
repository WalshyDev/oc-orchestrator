import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.userData } }))

describe('app settings persistence', () => {
  let database: typeof import('../main/services/database').database
  let storage: Map<string, string>

  async function startApp(beforeInitialize?: () => void) {
    vi.resetModules()
    database = (await import('../main/services/database')).database
    await database.init()
    vi.stubGlobal('window', {
      api: {
        getPreference: vi.fn(async (key: string) => ({ ok: true, data: database.getPreference(key) })),
        setPreference: vi.fn(async (key: string, value: string) => {
          database.setPreference(key, value)
          return { ok: true }
        })
      },
      dispatchEvent: vi.fn()
    })
    const settings = await import('../renderer/src/data/settings')
    beforeInitialize?.()
    await settings.initializeSettings()
    return settings
  }

  beforeEach(() => {
    state.userData = mkdtempSync(join(tmpdir(), 'oco-settings-'))
    storage = new Map()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value)
    })
    vi.stubGlobal('CustomEvent', class { constructor(public type: string) {} })
  })

  afterEach(() => {
    database?.close()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    rmSync(state.userData, { recursive: true, force: true })
  })

  it('migrates existing commands and restores edits after a restart on another origin', async () => {
    const original = {
      model: 'openai/custom-model',
      editor: 'goland',
      verboseMode: true,
      quickActions: [{ id: 'custom', label: 'Review', icon: 'code', prompt: '/review' }, null],
      notifications: { completed: true }
    }
    storage.set('oc-orchestrator:settings', JSON.stringify(original))
    const first = await startApp()
    expect(first.loadSettings().quickActions[0]?.prompt).toBe('/review')
    database.close()
    storage = new Map()
    const migrated = await startApp()
    expect(migrated.loadSettings().quickActions[0]?.prompt).toBe('/review')
    const edited = {
      ...migrated.loadSettings(),
      quickActions: [null, { id: 'ship', label: 'Finish', icon: 'rocket' as const, prompt: '/finishup' }, ...new Array(5).fill(null)]
    }
    migrated.saveSettings(edited)
    await Promise.resolve()
    database.close()

    storage = new Map()
    const restarted = await startApp()
    expect(restarted.loadSettings()).toEqual(edited)
    expect(restarted.loadSettings().model).toBe(original.model)
    expect(restarted.loadSettings().outputVerbosity).toBe('all')
    expect(restarted.loadSettings().notifications.completed).toBe(true)
  })

  it('uses saved database settings instead of stale settings on the new origin', async () => {
    const first = await startApp()
    const saved = { ...first.DEFAULT_SETTINGS, quickActions: [{ id: 'saved', label: 'Saved', icon: 'code' as const, prompt: '/saved' }] }
    first.saveSettings(saved)
    await Promise.resolve()
    database.close()
    storage.set(first.SETTINGS_STORAGE_KEY, JSON.stringify({ model: 'stale-model', quickActions: [] }))
    const restarted = await startApp()
    expect(restarted.loadSettings().quickActions[0]?.prompt).toBe('/saved')
    expect(restarted.loadSettings().model).toBe('auto')
    expect(JSON.parse(storage.get(first.SETTINGS_STORAGE_KEY)!).quickActions[0].prompt).toBe('/saved')
    database.close()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fallback = await startApp(() => {
      vi.mocked(window.api.getPreference).mockResolvedValue({ ok: false, error: 'Read failed' })
    })
    expect(fallback.loadSettings().quickActions[0]?.prompt).toBe('/saved')
  })

  it('does not seed defaults before an origin containing existing commands can migrate', async () => {
    const emptyOrigin = await startApp()
    expect(database.getPreference(emptyOrigin.SETTINGS_STORAGE_KEY)).toBeUndefined()
    expect(storage.get(emptyOrigin.SETTINGS_STORAGE_KEY)).toBeUndefined()
    database.close()
    storage.set(emptyOrigin.SETTINGS_STORAGE_KEY, JSON.stringify({
      quickActions: [{ id: 'legacy', label: 'Legacy', icon: 'code', prompt: '/legacy' }]
    }))
    const legacyOrigin = await startApp()
    expect(legacyOrigin.loadSettings().quickActions[0]?.prompt).toBe('/legacy')
    database.close()
    storage = new Map()
    const restarted = await startApp()
    expect(restarted.loadSettings().quickActions[0]?.prompt).toBe('/legacy')
  })

  it('keeps saving commands when browser storage is unavailable', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const settings = await startApp(() => {
      vi.stubGlobal('localStorage', {
        getItem: () => { throw new Error('Storage unavailable') },
        setItem: () => { throw new Error('Storage unavailable') }
      })
    })
    const saved = { ...settings.DEFAULT_SETTINGS, createPrPrompt: '/finishup' }
    settings.saveSettings(saved)
    await Promise.resolve()
    expect(settings.loadSettings()).toEqual(saved)
    database.close()
    const restarted = await startApp()
    expect(restarted.loadSettings().createPrPrompt).toBe('/finishup')
    expect(error).toHaveBeenCalledWith('Failed to cache app settings', expect.any(Error))
  })

  it('preserves local settings and avoids overwriting the database after a failed read', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    storage.set('oc-orchestrator:settings', JSON.stringify({ createPrPrompt: '/local' }))
    const settings = await startApp(() => {
      vi.mocked(window.api.getPreference).mockResolvedValue({ ok: false, error: 'Read failed' })
    })
    expect(settings.loadSettings().createPrPrompt).toBe('/local')
    settings.saveSettings({ ...settings.loadSettings(), editor: 'goland' })
    expect(window.api.setPreference).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith('Failed to initialize app settings', expect.any(Error))
  })

  it('reports database write failures while keeping the local copy', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const settings = await startApp()
    vi.mocked(window.api.setPreference).mockResolvedValue({ ok: false, error: 'Write failed' })
    const saved = { ...settings.loadSettings(), createPrPrompt: '/local' }
    settings.saveSettings(saved)
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith('Failed to save app settings', expect.any(Error)))
    expect(JSON.parse(storage.get(settings.SETTINGS_STORAGE_KEY)!)).toEqual(saved)
  })
})
