import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  calculateQuickActionPlaceholderCount,
  getVisibleEmptyQuickActionSlotIndexes,
  loadSettings,
  MAX_QUICK_ACTIONS,
  SETTINGS_STORAGE_KEY,
  type QuickActionSlots,
} from '../renderer/src/data/settings'

afterEach(() => vi.unstubAllGlobals())

describe('calculateQuickActionPlaceholderCount', () => {
  it('fills empty rails according to the available width', () => {
    expect(calculateQuickActionPlaceholderCount(376, [], 72, 4, 12)).toBe(5)
    expect(calculateQuickActionPlaceholderCount(576, [], 72, 4, 12)).toBe(7)
    expect(calculateQuickActionPlaceholderCount(976, [], 72, 4, 12)).toBe(12)
  })

  it('reserves room for configured and permission actions', () => {
    expect(calculateQuickActionPlaceholderCount(576, [90, 110, 60], 72, 4, 12)).toBe(4)
  })

  it('does not add placeholders when required actions already fill the rail', () => {
    expect(calculateQuickActionPlaceholderCount(300, [180, 140], 72, 4, 12)).toBe(0)
  })

  it('does not exceed the number of empty configured slots', () => {
    expect(calculateQuickActionPlaceholderCount(976, [], 72, 4, 3)).toBe(3)
  })
})

describe('getVisibleEmptyQuickActionSlotIndexes', () => {
  it('selects null slots in positional order without hiding configured entries', () => {
    const quickActions: QuickActionSlots = [
      null,
      { id: 'ready', label: 'Ready', icon: 'lightning', prompt: 'Go' },
      null,
      { id: 'incomplete', label: 'Incomplete', icon: 'wrench', prompt: '' },
      null,
    ]

    expect([...getVisibleEmptyQuickActionSlotIndexes(quickActions, 2)]).toEqual([0, 2])
    expect([...getVisibleEmptyQuickActionSlotIndexes(quickActions, 5)]).toEqual([0, 2, 4])
  })
})

describe('quick-action settings migration', () => {
  it('preserves existing slot order while extending stored settings to the new capacity', () => {
    const first = { id: 'first', label: 'First', icon: 'lightning' as const, prompt: 'One' }
    const third = { id: 'third', label: 'Third', icon: 'wrench' as const, prompt: 'Three' }
    const storedSettings = JSON.stringify({ quickActions: [first, null, third] })
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => key === SETTINGS_STORAGE_KEY ? storedSettings : null,
    })

    const quickActions = loadSettings().quickActions

    expect(quickActions).toHaveLength(MAX_QUICK_ACTIONS)
    expect(quickActions.slice(0, 3)).toEqual([first, null, third])
    expect(quickActions.slice(3)).toEqual(new Array(MAX_QUICK_ACTIONS - 3).fill(null))
  })
})
