// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LaunchModal } from '../renderer/src/components/LaunchModal'
import { App } from '../renderer/src/App'
import { createDemoApi } from '../renderer/src/demoApi'

vi.mock('../renderer/src/components/WorkspaceView', () => ({ WorkspaceView: () => null }))
vi.mock('../renderer/src/components/DetailDrawer', () => ({ DetailDrawer: () => null }))
vi.mock('../renderer/src/hooks/useModelOptions', async (importOriginal) => {
  const original = await importOriginal<typeof import('../renderer/src/hooks/useModelOptions')>()
  return {
    ...original,
    useModelOptions: () => ({ options: [{ value: 'auto', label: 'Default' }], loading: false, providerData: {} })
  }
})

let root: Root
let container: HTMLDivElement
const sessions = [
  { id: 'source-a', title: 'Session A', directory: '/tmp/repo', updatedAt: 2, createdAt: 1 },
  { id: 'source-b', title: 'Session B', directory: '/tmp/repo', updatedAt: 1, createdAt: 1 }
]

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
  localStorage.clear()
  window.api = {
    ...createDemoApi(),
    listAgents: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    listProjects: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'project', name: 'Repo', repo_root: '/tmp/repo' }] }),
    getPreference: vi.fn().mockResolvedValue({ ok: true, data: '/tmp/repo' }),
    listSessionsByProject: vi.fn().mockResolvedValue({ ok: true, data: sessions }),
    getProviders: vi.fn().mockResolvedValue({ ok: true, data: { providers: [], default: {} } }),
    sendMessage: vi.fn().mockResolvedValue({ ok: true }),
    sendMessageWithModel: vi.fn().mockResolvedValue({ ok: true })
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function settle(ms = 0) {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
}

async function clickButton(text: string) {
  const button = Array.from(document.querySelectorAll('button')).find((element) => element.textContent?.trim() === text)
  expect(button, `button ${text}`).toBeDefined()
  await act(async () => button!.click())
}

async function selectSession(title = 'Session A') {
  await clickButton('Import Session')
  await settle()
  const dropdown = Array.from(document.querySelectorAll('button')).find((element) => element.textContent?.includes('Select a session'))!
  await act(async () => dropdown.click())
  const entry = Array.from(document.querySelectorAll('div')).find((element) => element.textContent === title)!
  await act(async () => entry.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
}

async function pasteScreenshot(deferDecode = false) {
  const textarea = document.querySelector('textarea')!
  const event = new Event('paste', { bubbles: true, cancelable: true })
  const file = new File(['screenshot'], 'Screenshot.png', { type: 'image/png' })
  Object.defineProperty(event, 'clipboardData', { value: { items: [{ type: file.type, getAsFile: () => file }] } })
  let finishDecode: (() => void) | undefined
  vi.stubGlobal('Image', class {
    naturalWidth = 100
    naturalHeight = 100
    onload?: () => void
    set src(_value: string) {
      finishDecode = () => this.onload?.()
      if (!deferDecode) queueMicrotask(finishDecode)
    }
  })
  await act(async () => textarea.dispatchEvent(event))
  await settle(20)
  expect(event.defaultPrevented).toBe(true)
  if (!deferDecode) expect(document.querySelector('img[alt="Screenshot.png"]')).not.toBeNull()
  expect(finishDecode).toBeDefined()
  return finishDecode!
}

async function renderModal() {
  const onLaunch = vi.fn()
  await act(async () => root.render(createElement(LaunchModal, {
    onClose: vi.fn(), onLaunch, onSelectDirectory: vi.fn().mockResolvedValue(null)
  })))
  await settle(550)
  return onLaunch
}

describe('launch prompt screenshot attachments', () => {
  it.each(['', 'Check this screenshot'])('forwards import screenshots with prompt %j', async (prompt) => {
    const onLaunch = await renderModal()
    await selectSession()
    await pasteScreenshot()
    if (prompt) {
      const textarea = document.querySelector('textarea')!
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, prompt)
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    await clickButton('Fork & Launch')
    expect(onLaunch).toHaveBeenCalledWith(
      '/tmp/repo', prompt || undefined, 'Session A (fork)', expect.any(String), undefined,
      'new-worktree', [expect.objectContaining({ filename: 'Screenshot.png', mime: 'image/png' })],
      undefined, expect.objectContaining({ sessionId: 'source-a' }), undefined, undefined
    )
  })

  it('clears import screenshots on tab reset while keeping the new prompt draft', async () => {
    const onLaunch = await renderModal()
    await pasteScreenshot()
    await selectSession()
    expect(document.querySelector('img[alt="Screenshot.png"]')).toBeNull()
    await pasteScreenshot()
    await clickButton('New Agent')
    expect(document.querySelector('img[alt="Screenshot.png"]')).not.toBeNull()
    await selectSession('Session B')
    expect(document.querySelector('img[alt="Screenshot.png"]')).toBeNull()
    await clickButton('Fork & Launch')
    expect(onLaunch.mock.calls[0][6]).toBeUndefined()
    expect(onLaunch.mock.calls[0][8]).toEqual(expect.objectContaining({ sessionId: 'source-b' }))
  })

  it('sends a screenshot without text after the app imports a session', async () => {
    await act(async () => root.render(createElement(App)))
    await clickButton('Launch Agent')
    await settle(550)
    await selectSession()
    await pasteScreenshot()
    await clickButton('Fork & Launch')
    await settle()
    expect(window.api.sendMessage).toHaveBeenCalledWith(
      'demo-imported', '', undefined,
      [expect.objectContaining({ filename: 'Screenshot.png', mime: 'image/png' })]
    )
  })

  it('discards an import screenshot that finishes decoding after its draft resets', async () => {
    const onLaunch = await renderModal()
    await selectSession()
    const finishDecode = await pasteScreenshot(true)
    await clickButton('New Agent')
    await act(async () => finishDecode())
    await selectSession('Session B')
    expect(document.querySelector('img[alt="Screenshot.png"]')).toBeNull()
    await clickButton('Fork & Launch')
    expect(onLaunch.mock.calls[0][6]).toBeUndefined()
  })
})

describe('launch directory validation', () => {
  it('respects the current directory strategy for Git imports', async () => {
    const onLaunch = await renderModal()
    await selectSession()
    await clickButton('New Worktree (recommended)')
    await clickButton('Use Current Directory')
    await clickButton('Fork & Launch')
    expect(onLaunch.mock.calls[0][5]).toBe('current-directory')
  })

  it('imports a home session without creating a Git worktree', async () => {
    const home = '/Users/example'
    window.api.getHomeDirectory = vi.fn().mockResolvedValue({ ok: true, data: home })
    window.api.validateDirectory = vi.fn().mockResolvedValue({ ok: true, data: true })
    window.api.validateGitRepo = vi.fn().mockResolvedValue({ ok: true, data: false })
    window.api.getRepoRoot = vi.fn().mockResolvedValue({ ok: false, error: 'Not a Git repository' })
    window.api.createWorktree = vi.fn()
    window.api.importSession = vi.fn().mockResolvedValue({
      ok: true, data: { id: 'home-import', sessionId: 'home-session', directory: home, status: 'idle' }
    })
    window.api.listSessionsByProject = vi.fn().mockResolvedValue({
      ok: true, data: [{ ...sessions[0], directory: home }]
    })
    await act(async () => root.render(createElement(App)))
    await clickButton('Launch Agent')
    await clickButton('Import Session')
    await settle()
    const directoryButton = Array.from(document.querySelectorAll('button')).find((element) => element.textContent?.includes('/tmp/repo'))!
    await act(async () => directoryButton.click())
    const homeButton = Array.from(document.querySelectorAll('button')).find((element) => element.textContent === 'Home / QuickStart (~)')!
    await act(async () => homeButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    await settle(550)
    expect(window.api.validateDirectory).toHaveBeenCalledWith(home)
    expect(window.api.validateGitRepo).not.toHaveBeenCalled()
    expect(window.api.listSessionsByProject).toHaveBeenCalledWith(home)
    expect(document.body.textContent).toContain('Use Current Directory')
    await selectSession()
    await clickButton('Fork & Launch')
    await settle()
    expect(window.api.importSession).toHaveBeenCalledWith(expect.objectContaining({
      sourceSessionId: 'source-a', sourceDirectory: home, targetDirectory: home
    }))
    expect(window.api.createWorktree).not.toHaveBeenCalled()
  })

  it('blocks missing directories before listing sessions', async () => {
    const onLaunch = vi.fn()
    await act(async () => root.render(createElement(LaunchModal, {
      onClose: vi.fn(), onLaunch, onSelectDirectory: vi.fn().mockResolvedValue(null),
      onValidateDirectory: vi.fn().mockResolvedValue(false)
    })))
    await clickButton('Import Session')
    await settle(550)
    expect(document.body.textContent).toContain('This directory does not exist or is not a folder.')
    expect(window.api.listSessionsByProject).not.toHaveBeenCalled()
    const launchButton = Array.from(document.querySelectorAll('button')).find((element) => element.textContent === 'Launch Agent')!
    expect(launchButton.disabled).toBe(true)
    await act(async () => launchButton.click())
    expect(onLaunch).not.toHaveBeenCalled()
  })
})
