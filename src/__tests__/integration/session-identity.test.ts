import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RuntimeInfo } from '../../main/services/runtime-manager'

vi.mock('electron', () => ({
  app: { getAppPath: () => process.cwd(), getPath: () => tmpdir() },
  BrowserWindow: { getAllWindows: () => [] },
  Notification: class { static isSupported(): boolean { return false } }
}))
vi.mock('../../main/services/database', () => ({
  database: { getPreference: () => undefined, setPreference: () => {} }
}))

const { runtimeManager } = await import('../../main/services/runtime-manager')
const { agentController } = await import('../../main/services/agent-controller')

describe.skipIf(!process.env.OPENCODE_INTEGRATION)('session identity through OpenCode', () => {
  let directory: string
  let provider: Server
  let runtime: RuntimeInfo | undefined
  const observedIdentities: string[] = []

  afterEach(async () => {
    if (runtime) await runtimeManager.stopRuntime(runtime.id)
    agentController.stopAll()
    if (provider) {
      provider.closeAllConnections()
      await new Promise<void>((resolve) => provider.close(() => resolve()))
    }
    if (directory) rmSync(directory, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('exposes the executing ID for shared sessions, commands, forks, imports and runtime restart', { timeout: 120_000 }, async () => {
    directory = realpathSync(mkdtempSync(join(tmpdir(), 'oco-identity-')))
    for (const [key, value] of Object.entries({
      HOME: directory,
      XDG_CONFIG_HOME: join(directory, 'config'),
      XDG_DATA_HOME: join(directory, 'data'),
      XDG_CACHE_HOME: join(directory, 'cache'),
      XDG_STATE_HOME: join(directory, 'state'),
      OPENCODE_TEST_HOME: directory,
      OPENCODE_DB: join(directory, 'opencode.db'),
      OPENCODE_DISABLE_DEFAULT_PLUGINS: '1'
    })) vi.stubEnv(key, value)
    provider = createServer(async (request, response) => {
      let body = ''
      for await (const chunk of request) body += chunk
      const input = JSON.parse(body)
      const hasBash = input.tools?.some((tool: { function?: { name?: string } }) => tool.function?.name === 'bash')
      if (hasBash) {
        const system = input.messages.filter((message: { role: string }) => message.role === 'system')
          .map((message: { content: string }) => message.content).join('\n')
        const identity = /Your current OpenCode session ID is "([^"]+)"/.exec(system)?.[1]
        observedIdentities.push(identity ?? 'missing')
      }
      const last = input.messages.at(-1)
      const callBash = hasBash && last.role !== 'tool'
      const delta = callBash ? {
        tool_calls: [{ index: 0, id: `call_${Date.now()}`, type: 'function', function: {
          name: 'bash',
          arguments: JSON.stringify({
            command: 'node -p "JSON.stringify([process.env.OPENCODE_SESSION_ID,process.env.OCO_SESSION_ID])"',
            description: 'Read the current session identity'
          })
        } }]
      } : { content: 'Done' }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end([
        `data: ${JSON.stringify({ id: 'identity', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`,
        `data: ${JSON.stringify({ id: 'identity', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: callBash ? 'tool_calls' : 'stop' }] })}\n\n`,
        'data: [DONE]\n\n'
      ].join(''))
    })
    await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve))
    const address = provider.address() as { port: number }
    writeFileSync(join(directory, 'opencode.json'), JSON.stringify({
      model: 'identity/test',
      small_model: 'identity/test',
      permission: 'allow',
      provider: {
        identity: {
          npm: '@ai-sdk/openai-compatible',
          name: 'Identity test',
          options: { baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: 'dummy' },
          models: { test: { name: 'Identity test', tool_call: true, limit: { context: 100000, output: 1000 } } }
        }
      },
      command: { identity: { template: 'Read the current session identity' } }
    }))
    vi.stubEnv('OPENCODE_CONFIG', join(directory, 'opencode.json'))
    vi.stubEnv('OPENCODE_SESSION_ID', 'inherited-stale-id')
    vi.stubEnv('OCO_SESSION_ID', 'inherited-parent-id')
    runtime = await runtimeManager.ensureRuntime(directory)
    const client = runtime.client
    const firstAgent = await agentController.launchAgent({ directory, title: 'First', model: 'identity/test', prompt: 'Read the current session identity' })
    const secondAgent = await agentController.launchAgent({ directory, title: 'Second', model: 'identity/test', prompt: 'Read the current session identity' })
    const first = { id: firstAgent.sessionId }
    const second = { id: secondAgent.sessionId }

    const assertIdentity = async (sessionID: string): Promise<void> => {
      const deadline = Date.now() + 20_000
      while (Date.now() < deadline) {
        const messages = (await runtime!.client.session.messages({ sessionID, directory })).data!
        const last = messages.at(-1)?.info
        if (last?.role === 'assistant' && last.time.completed) break
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      const messages = (await runtime!.client.session.messages({ sessionID, directory })).data!
      const tool = messages.flatMap((message) => message.parts)
        .filter((part) => part.type === 'tool').at(-1)
      expect(tool?.type).toBe('tool')
      if (tool?.type !== 'tool' || tool.state.status !== 'completed') throw new Error(JSON.stringify(tool))
      expect(tool.state.output.trim()).toBe(JSON.stringify([sessionID, sessionID]))
      expect(observedIdentities).toContain(sessionID)
      expect(observedIdentities).not.toContain('missing')
    }
    const prompt = async (sessionID: string): Promise<void> => {
      const result = await runtime!.client.session.prompt({
        sessionID, directory, model: { providerID: 'identity', modelID: 'test' },
        parts: [{ type: 'text', text: 'Read the current session identity' }]
      }, { signal: AbortSignal.timeout(20_000) })
      expect(result.error).toBeUndefined()
      await assertIdentity(sessionID)
    }

    await Promise.all([assertIdentity(first.id), assertIdentity(second.id)])
    expect(runtimeManager.findByDirectory(directory)?.id).toBe(runtime.id)

    const command = await client.session.command({ sessionID: second.id, directory, command: 'identity', arguments: '' })
    expect(command.error).toBeUndefined()
    const commandMessages = (await client.session.messages({ sessionID: second.id, directory })).data!
    const commandTools = commandMessages.flatMap((message) => message.parts).filter((part) => part.type === 'tool')
    expect(commandTools).toHaveLength(2)
    const commandTool = commandTools.at(-1)
    expect(commandTool).toMatchObject({ type: 'tool', state: { status: 'completed' } })
    expect(commandTool?.type === 'tool' && commandTool.state.status === 'completed' && commandTool.state.output.trim())
      .toBe(JSON.stringify([second.id, second.id]))

    const fork = (await client.session.fork({ sessionID: first.id, directory })).data!
    await prompt(fork.id)
    const child = (await client.session.create({ parentID: first.id, directory, title: 'Child' })).data!
    await prompt(child.id)
    const imported = (await client.session.create({ directory, title: 'Imported' })).data!
    await client.session.prompt({ sessionID: imported.id, directory, noReply: true, parts: [{
      type: 'text', synthetic: true, text: `Imported transcript says the old session was ${first.id}`
    }] })
    await prompt(imported.id)

    const compaction = await client.session.summarize({ sessionID: second.id, directory, providerID: 'identity', modelID: 'test' })
    expect(compaction.error).toBeUndefined()
    await prompt(second.id)

    await runtimeManager.stopRuntime(runtime.id)
    runtime = await runtimeManager.ensureRuntime(directory)
    await prompt(first.id)
    const reset = (await runtime.client.session.create({ directory, title: 'Reset' })).data!
    await prompt(reset.id)
  })
})
