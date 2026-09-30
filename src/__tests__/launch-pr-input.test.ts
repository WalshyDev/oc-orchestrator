import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LaunchModal } from '../renderer/src/components/LaunchModal'
import { buildLaunchPrompt, parseLaunchPrUrl } from '../renderer/src/lib/launch-pr-input'

afterEach(() => vi.unstubAllGlobals())

describe('launch PR input', () => {
  it.each([
    'https://github.com/owner/repo/pull/123',
    'https://gitlab.cfdata.org/group/repo/-/merge_requests/42?tab=changes#diff',
    'https://forge.example.org/group/repo/-/merge_requests/42/',
  ])('accepts and trims a PR or MR URL %s', (url) => {
    expect(parseLaunchPrUrl(` ${url} `)).toBe(url)
  })

  it.each(['', 'not a URL', 'https://github.com/owner/repo', 'javascript:alert(1)', 'https://user:password@github.com/owner/repo/pull/1'])('rejects non-PR input %s', (input) => {
    expect(parseLaunchPrUrl(input)).toBeUndefined()
  })

  it('keeps slash commands and agent mentions routable with the URL as an argument', () => {
    const url = 'https://github.com/owner/repo/pull/123'
    const commandPrompt = buildLaunchPrompt('/review', url)!
    const commandEnd = commandPrompt.indexOf(' ')
    expect(commandPrompt.slice(1, commandEnd)).toBe('review')
    expect(commandPrompt.slice(commandEnd + 1)).toBe(url)

    const agentPrompt = buildLaunchPrompt('@reviewer', url)!
    expect(agentPrompt.match(/^@(\w+)(?:\s|$)/)?.[1]).toBe('reviewer')
    expect(agentPrompt.slice('@reviewer '.length)).toBe(url)
    expect(buildLaunchPrompt('Review the changes', url)).toBe(`Review the changes ${url}`)
    expect(buildLaunchPrompt('', url)).toBe(url)
    expect(buildLaunchPrompt('Existing prompt')).toBe('Existing prompt')
    expect(buildLaunchPrompt('')).toBeUndefined()
  })

  it('renders the optional PR link input in the new session modal', () => {
    vi.stubGlobal('localStorage', { getItem: () => null })
    const markup = renderToStaticMarkup(createElement(LaunchModal, {
      onClose: vi.fn(),
      onLaunch: vi.fn(),
      onSelectDirectory: vi.fn().mockResolvedValue(null),
    }))
    expect(markup).toContain('id="launch-pr-url"')
    expect(markup).toContain('type="url"')
    expect(markup).toContain('PR / MR Link')
  })
})
