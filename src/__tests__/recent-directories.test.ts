import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import {
  recordRecentDirectory,
  removeRecentDirectory,
  RECENT_DIRECTORIES_STORAGE_KEY,
} from '../renderer/src/hooks/useRecentDirectories'
import { ProjectDirectoryOptions } from '../renderer/src/components/ProjectDirectoryOptions'
import type { Project } from '../renderer/src/types/api'

let storage: Map<string, string>

function storedDirectories(): string[] {
  return JSON.parse(storage.get(RECENT_DIRECTORIES_STORAGE_KEY)!)
}

beforeEach(() => {
  storage = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  })
  vi.stubGlobal('window', new EventTarget())
})

afterEach(() => vi.unstubAllGlobals())

describe('recent directories', () => {
  it('keeps the last five distinct directories, moving a reused one to the front', () => {
    for (const directory of ['/a', '/b', '/c', '/d', '/e', '/f', ' /c ']) recordRecentDirectory(directory)
    expect(storedDirectories()).toEqual(['/c', '/f', '/e', '/d', '/b'])
  })

  it('ignores empty paths, recovers from invalid history, and removes entries', () => {
    storage.set(RECENT_DIRECTORIES_STORAGE_KEY, '[null,3,"/a","/a"," "]')
    recordRecentDirectory('  ')
    recordRecentDirectory('/z')
    expect(storedDirectories()).toEqual(['/z', '/a'])
    storage.set(RECENT_DIRECTORIES_STORAGE_KEY, 'not json')
    recordRecentDirectory('/b')
    recordRecentDirectory('/c')
    removeRecentDirectory('/b')
    expect(storedDirectories()).toEqual(['/c'])
  })

  it('lists recent directories above saved projects without repeating them', () => {
    recordRecentDirectory('/repos/other')
    recordRecentDirectory('/home/me')
    recordRecentDirectory('/repos/api')
    const projects = [
      { id: '1', name: 'web', repo_root: '/repos/web' },
      { id: '2', name: 'api', repo_root: '/repos/api' },
    ] as Project[]
    const markup = renderToStaticMarkup(createElement(ProjectDirectoryOptions, {
      projects, search: '', homeDirectory: '/home/me', onSelect: vi.fn(), onRemove: vi.fn(),
    }))
    const order = ['Recently Used', '/repos/api', 'Home / QuickStart', '/repos/other', 'Saved Projects', '/repos/web']
      .map((text) => markup.indexOf(text))
    expect(order.every((index, i) => index >= 0 && (i === 0 || index > order[i - 1]))).toBe(true)
    expect(markup.split('/repos/api').length - 1).toBe(1)
  })

  it('filters both groups by name or path', () => {
    recordRecentDirectory('/repos/api')
    const projects = [{ id: '1', name: 'web', repo_root: '/repos/web' }] as Project[]
    const render = (search: string) => renderToStaticMarkup(createElement(ProjectDirectoryOptions, {
      projects, search, homeDirectory: '', onSelect: vi.fn(), onRemove: vi.fn(),
    }))
    expect(render('WEB')).not.toContain('Recently Used')
    expect(render('WEB')).toContain('/repos/web')
    expect(render('zzz')).toContain('No matching projects')
  })
})
