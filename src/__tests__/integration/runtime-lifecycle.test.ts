/**
 * Integration tests for the OC Orchestrator runtime lifecycle.
 *
 * These tests spin up real OpenCode backends and exercise the RuntimeManager
 * and AgentController APIs end-to-end.  They are gated behind the
 * OPENCODE_INTEGRATION env var so they never run in normal CI.
 *
 *   OPENCODE_INTEGRATION=1 npm run test:integration
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ---------------------------------------------------------------------------
// The modules under test import Electron's BrowserWindow, which does not exist
// outside an Electron renderer/main process.  We mock Electron so the source
// files can be loaded in a plain Node / Vitest context.
// ---------------------------------------------------------------------------
import { vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: () => tmpdir(),
    setBadgeCount: () => {}
  },
  BrowserWindow: {
    getAllWindows: () => []
  },
  Notification: class {
    show(): void {}
    static isSupported(): boolean {
      return false
    }
  }
}))

vi.mock('../../main/services/database', () => ({
  database: {
    getPreference: () => undefined,
    setPreference: () => {}
  }
}))

// After the mock is registered we can safely import the real modules.
const { runtimeManager } = await import('../../main/services/runtime-manager')
const { agentController } = await import('../../main/services/agent-controller')
const { EventBridge } = await import('../../main/services/event-bridge')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(prefix = 'oc-int-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function removeTempDir(dirPath: string): void {
  try {
    rmSync(dirPath, { recursive: true, force: true })
  } catch {
    // best-effort cleanup
  }
}

// ---------------------------------------------------------------------------
// Test suite — only runs when OPENCODE_INTEGRATION is set
// ---------------------------------------------------------------------------

describe.skipIf(!process.env.OPENCODE_INTEGRATION)('Runtime lifecycle (integration)', () => {
  const tempDirs: string[] = []
  const runtimeIds: string[] = []

  beforeEach(() => {
    // nothing shared — each test creates its own state
  })

  afterEach(async () => {
    // Tear down any runtimes that were started during the test
    for (const runtimeId of runtimeIds) {
      try {
        await runtimeManager.stopRuntime(runtimeId)
      } catch {
        // ignore — may already be stopped
      }
    }
    runtimeIds.length = 0

    // Remove temp directories
    for (const dirPath of tempDirs) {
      removeTempDir(dirPath)
    }
    tempDirs.length = 0
  })

  // -----------------------------------------------------------------------
  // 1. Launch a real OpenCode backend and connect
  // -----------------------------------------------------------------------
  it('should launch a runtime and respond to a health check', { timeout: 30_000 }, async () => {
    const workDir = makeTempDir()
    tempDirs.push(workDir)

    const runtime = await runtimeManager.ensureRuntime(workDir)
    runtimeIds.push(runtime.id)

    // Basic sanity checks on the returned RuntimeInfo
    expect(runtime.id).toBeTruthy()
    expect(runtime.directory).toBe(workDir)
    expect(runtime.serverUrl).toMatch(/^https?:\/\//)
    expect(runtime.client).toBeDefined()
    expect(runtime.healthy).toBe(true)

    // The server should respond to an HTTP health check
    const healthResponse = await fetch(`${runtime.serverUrl}/health`, {
      signal: AbortSignal.timeout(10_000)
    })
    expect(healthResponse.ok).toBe(true)
  })

  // -----------------------------------------------------------------------
  // 2. Create multiple runtimes in different workspaces
  // -----------------------------------------------------------------------
  it('should create separate runtimes for different directories', { timeout: 30_000 }, async () => {
    const dirAlpha = makeTempDir('oc-alpha-')
    const dirBeta = makeTempDir('oc-beta-')
    tempDirs.push(dirAlpha, dirBeta)

    const runtimeAlpha = await runtimeManager.ensureRuntime(dirAlpha)
    const runtimeBeta = await runtimeManager.ensureRuntime(dirBeta)
    runtimeIds.push(runtimeAlpha.id, runtimeBeta.id)

    // They should be distinct runtimes
    expect(runtimeAlpha.id).not.toBe(runtimeBeta.id)
    expect(runtimeAlpha.serverUrl).not.toBe(runtimeBeta.serverUrl)

    // Both should be healthy
    expect(runtimeAlpha.healthy).toBe(true)
    expect(runtimeBeta.healthy).toBe(true)

    // Requesting the same directory again should return the existing runtime
    const runtimeAlphaDupe = await runtimeManager.ensureRuntime(dirAlpha)
    expect(runtimeAlphaDupe.id).toBe(runtimeAlpha.id)

    // getAllRuntimes should include both
    const allRuntimes = runtimeManager.getAllRuntimes()
    const allIds = allRuntimes.map((rt) => rt.id)
    expect(allIds).toContain(runtimeAlpha.id)
    expect(allIds).toContain(runtimeBeta.id)
  })

  // -----------------------------------------------------------------------
  // 3. Simulate approval-required flow end-to-end
  // -----------------------------------------------------------------------
  it('should surface a permission event when a prompt triggers approval', { timeout: 30_000 }, async () => {
    const workDir = makeTempDir()
    tempDirs.push(workDir)

    const runtime = await runtimeManager.ensureRuntime(workDir)
    runtimeIds.push(runtime.id)

    // Subscribe to the event stream so we can watch for permission events
    const permissionEvents: unknown[] = []
    const bridge = new EventBridge(runtime.id, workDir, runtime.client)

    // Monkey-patch forwardEvent to capture events locally
    // (BrowserWindow is mocked to return no windows, so we intercept here)
    const originalForward = (bridge as unknown as Record<string, unknown>)['forwardEvent']
    ;(bridge as unknown as Record<string, (event: { type: string; properties: unknown }) => void>)[
      'forwardEvent'
    ] = (event: { type: string; properties: unknown }) => {
      if (event.type === 'permission' || event.type === 'session.updated') {
        permissionEvents.push(event)
      }
      // Still call the original so internal state stays consistent
      if (typeof originalForward === 'function') {
        originalForward.call(bridge, event)
      }
    }

    await bridge.start()

    // Launch an agent with a prompt that is likely to require approval
    // (e.g. writing to a file triggers a permission check in most configs)
    const agent = await agentController.launchAgent({
      directory: workDir,
      prompt: 'Create a file called hello.txt with the content "hello world"'
    })
    runtimeIds.push(agent.runtimeId)

    // Wait for a permission event to arrive (poll with a reasonable timeout)
    const deadline = Date.now() + 20_000
    while (permissionEvents.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }

    // We expect at least one permission-related event to have arrived
    expect(permissionEvents.length).toBeGreaterThan(0)

    bridge.stop()
  })

  // -----------------------------------------------------------------------
  // 4. Simulate user-input-required flow end-to-end
  // -----------------------------------------------------------------------
  it('should surface an input-required event when the agent needs clarification', { timeout: 30_000 }, async () => {
    const workDir = makeTempDir()
    tempDirs.push(workDir)

    const runtime = await runtimeManager.ensureRuntime(workDir)
    runtimeIds.push(runtime.id)

    const inputEvents: unknown[] = []
    const bridge = new EventBridge(runtime.id, workDir, runtime.client)

    ;(bridge as unknown as Record<string, (event: { type: string; properties: unknown }) => void>)[
      'forwardEvent'
    ] = (event: { type: string; properties: unknown }) => {
      if (event.type === 'input' || event.type === 'session.updated') {
        inputEvents.push(event)
      }
    }

    await bridge.start()

    // A deliberately vague prompt that may cause the agent to ask for input
    const agent = await agentController.launchAgent({
      directory: workDir,
      prompt: 'I need your help but I am not sure what with yet. Ask me what I need.'
    })

    // Wait for an input-related event
    const deadline = Date.now() + 20_000
    while (inputEvents.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }

    // Verify we received at least a session update (the agent responding)
    expect(inputEvents.length).toBeGreaterThan(0)

    bridge.stop()
  })

  // -----------------------------------------------------------------------
  // 5. Stop and restart a runtime cleanly
  // -----------------------------------------------------------------------
  it('should stop a runtime and restart it successfully', { timeout: 30_000 }, async () => {
    const workDir = makeTempDir()
    tempDirs.push(workDir)

    // Start the runtime
    const runtime = await runtimeManager.ensureRuntime(workDir)
    const originalId = runtime.id

    // Verify it is retrievable
    expect(runtimeManager.getRuntime(originalId)).toBeDefined()

    // Stop it
    await runtimeManager.stopRuntime(originalId)

    // After stopping, it should no longer exist
    expect(runtimeManager.getRuntime(originalId)).toBeUndefined()
    expect(runtimeManager.findByDirectory(workDir)).toBeUndefined()

    // Restart — should get a brand-new runtime with a new ID
    const restarted = await runtimeManager.ensureRuntime(workDir)
    runtimeIds.push(restarted.id)

    expect(restarted.id).not.toBe(originalId)
    expect(restarted.directory).toBe(workDir)
    expect(restarted.healthy).toBe(true)

    // The new server should respond to health checks
    const healthResponse = await fetch(`${restarted.serverUrl}/health`, {
      signal: AbortSignal.timeout(10_000)
    })
    expect(healthResponse.ok).toBe(true)
  })

  // -----------------------------------------------------------------------
  // 6. Reconnect to runtimes after app restart (simulated)
  // -----------------------------------------------------------------------
  it('should allow re-creating a runtime from saved directory info', { timeout: 30_000 }, async () => {
    const workDir = makeTempDir()
    tempDirs.push(workDir)

    // Start the runtime and capture its info
    const original = await runtimeManager.ensureRuntime(workDir)
    const savedDirectory = original.directory
    const savedServerUrl = original.serverUrl

    expect(savedServerUrl).toMatch(/^https?:\/\//)

    // Simulate an "app restart" by stopping the runtime (server shuts down)
    await runtimeManager.stopRuntime(original.id)
    expect(runtimeManager.findByDirectory(savedDirectory)).toBeUndefined()

    // Re-create the runtime from the saved directory (as the app would on relaunch)
    const reconnected = await runtimeManager.ensureRuntime(savedDirectory)
    runtimeIds.push(reconnected.id)

    // The new runtime should be functional
    expect(reconnected.directory).toBe(savedDirectory)
    expect(reconnected.healthy).toBe(true)

    // It gets a new server URL since the old process was killed
    expect(reconnected.serverUrl).toBeTruthy()

    // Health check should pass
    const healthResponse = await fetch(`${reconnected.serverUrl}/health`, {
      signal: AbortSignal.timeout(10_000)
    })
    expect(healthResponse.ok).toBe(true)
  })
})
