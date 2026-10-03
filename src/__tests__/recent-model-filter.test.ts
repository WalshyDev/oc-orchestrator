import { expect, it, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ModelPickerModal } from '../renderer/src/components/ModelPickerModal'
import { SelectField } from '../renderer/src/components/SelectField'

const { states } = vi.hoisted(() => ({ states: [] as unknown[] }))
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useState: () => [states.shift(), vi.fn()],
}))
vi.mock('../renderer/src/components/PortaledMenu', () => ({
  PortaledMenu: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('../renderer/src/hooks/useRecentModels', async (importOriginal) => ({
  ...await importOriginal<typeof import('../renderer/src/hooks/useRecentModels')>(),
  useRecentModels: () => ['openai/hidden', 'openai/match'],
}))

it.each(['', 'matching', 'no matches'])('filters recent models normally and keeps matching models first for %j', (query) => {
  const models = [
    { id: 'normal', name: 'Matching ordinary', providerID: 'openai' },
    { id: 'match', name: 'Matching recent', providerID: 'openai' },
    { id: 'hidden', name: 'Hidden recent', providerID: 'openai' },
  ]
  states.push(true, query)
  const dropdown = renderToStaticMarkup(createElement(SelectField, {
    value: 'auto',
    options: [{ value: 'auto', label: 'System Default' }, ...models.map((model) => ({ value: `openai/${model.id}`, label: model.name }))],
    recentValues: ['openai/hidden', 'openai/match'],
    searchable: true,
    onChange: vi.fn(),
  }))
  states.push([{ id: 'openai', name: 'OpenAI', models }], false, query, null, null)
  const picker = renderToStaticMarkup(createElement(ModelPickerModal, {
    agentId: 'parent', onClose: vi.fn(), onSelect: vi.fn(),
  }))
  for (const markup of [dropdown, picker]) {
    if (query === 'no matches') {
      expect(markup).not.toContain('Recently used')
      expect(markup).not.toContain('Matching recent')
    } else {
      expect(markup).toContain('Recently used')
      expect(markup.indexOf('Matching recent')).toBeLessThan(markup.indexOf('Matching ordinary'))
      expect(markup.includes('Hidden recent')).toBe(query === '')
    }
  }
  expect(states).toEqual([])
})
