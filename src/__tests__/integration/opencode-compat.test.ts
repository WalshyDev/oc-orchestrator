import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createServer, type ServerResponse } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { OpencodeClient } from '@opencode-ai/sdk/v2/client'

vi.mock('electron', () => ({
  app: { getAppPath: () => process.cwd(), getPath: () => tmpdir(), setBadgeCount: () => {} },
  BrowserWindow: { getAllWindows: () => [] },
  Notification: class {
    show(): void {}
    static isSupported(): boolean {
      return false
    }
  }
}))
vi.mock('../../main/services/database', () => ({
  database: { getPreference: () => undefined, setPreference: () => {} }
}))

const { runtimeManager } = await import('../../main/services/runtime-manager')
const { agentController } = await import('../../main/services/agent-controller')
const { EventBridge } = await import('../../main/services/event-bridge')

interface ModelMessage {
  role: string
  content: unknown
  tool_call_id?: string
}

async function until(check: () => boolean | Promise<boolean>, timeout = 15_000): Promise<void> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Timed out waiting for OpenCode')
}

describe.skipIf(!process.env.OPENCODE_INTEGRATION)('OpenCode conversation compatibility (integration)', () => {
  let root: string
  let directory: string
  let bridge: InstanceType<typeof EventBridge> | undefined
  const requests: ModelMessage[][] = []
  const events: Array<{ type: string; properties: unknown }> = []
  const held = new Set<ServerResponse>()
  const model = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) {
      raw += chunk
    }
    const body = JSON.parse(raw) as { messages: ModelMessage[] }
    requests.push(body.messages)
    const user = body.messages.filter((message) => message.role === 'user').at(-1)
    const text = JSON.stringify(user?.content ?? '')
    const completed = (id: string): boolean =>
      body.messages.some((message) => message.role === 'tool' && message.tool_call_id === id)
    const tool = (() => {
      if (text.includes('compat-permission') && !completed('call_permission')) {
        return {
          id: 'call_permission',
          name: 'write',
          arguments: JSON.stringify({
            filePath: join(directory, 'hello.txt'),
            content: 'hello world'
          })
        }
      }
      if (text.includes('compat-question') && !completed('call_question')) {
        return {
          id: 'call_question',
          name: 'question',
          arguments: JSON.stringify({
            questions: [{
              question: 'Pick a color',
              header: 'Color',
              options: [{ label: 'Blue', description: 'Blue' }]
            }]
          })
        }
      }
      return undefined
    })()
    const answer = (() => {
      if (text.includes('compat-permission')) return 'PERMISSION_OK'
      if (text.includes('compat-question')) return 'QUESTION_OK'
      if (text.includes('compat-resume')) return 'RESUME_OK'
      return 'STREAM_OK'
    })()
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    const chunk = (delta: unknown, finish: string | null = null): void => {
      const data = {
        id: 'completion_1',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'compat',
        choices: [{ index: 0, delta, finish_reason: finish }]
      }
      res.write(`data: ${JSON.stringify(data)}\n\n`)
    }
    chunk({ role: 'assistant' })
    if (text.includes('compat-hang')) {
      held.add(res)
      res.on('close', () => held.delete(res))
      return
    }
    if (tool) {
      chunk({
        tool_calls: [{
          index: 0,
          id: tool.id,
          type: 'function',
          function: { name: tool.name, arguments: tool.arguments }
        }]
      })
      chunk({}, 'tool_calls')
    } else {
      chunk({ content: answer })
      chunk({}, 'stop')
    }
    res.end('data: [DONE]\n\n')
  })

  beforeAll(async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'oco-compat-')))
    directory = join(root, 'project')
    mkdirSync(directory)
    for (const [key, path] of Object.entries({
      HOME: root,
      XDG_CONFIG_HOME: join(root, 'config'),
      XDG_DATA_HOME: join(root, 'data'),
      XDG_CACHE_HOME: join(root, 'cache'),
      XDG_STATE_HOME: join(root, 'state'),
      OPENCODE_TEST_HOME: root,
      OPENCODE_DB: join(root, 'opencode.db'),
      OPENCODE_DISABLE_DEFAULT_PLUGINS: '1'
    })) {
      vi.stubEnv(key, path)
    }
    await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve))
    const address = model.address()
    if (!address || typeof address === 'string') {
      throw new Error('Model stub did not start')
    }
    const config = join(root, 'opencode.json')
    writeFileSync(config, JSON.stringify({
      model: 'compat/compat',
      small_model: 'compat/compat',
      plugin: [],
      permission: { '*': 'allow', edit: 'ask' },
      provider: {
        compat: {
          npm: '@ai-sdk/openai-compatible',
          name: 'Compatibility test',
          options: { baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: 'dummy' },
          models: {
            compat: {
              name: 'Compatibility test',
              tool_call: true,
              limit: { context: 32000, output: 4096 }
            }
          }
        }
      }
    }))
    vi.stubEnv('OPENCODE_CONFIG', config)
  })

  afterAll(async () => {
    bridge?.stop()
    agentController.stopAll()
    for (const res of held) {
      res.destroy()
    }
    model.closeAllConnections()
    await new Promise<void>((resolve) => model.close(() => resolve()))
    vi.unstubAllEnvs()
    if (root) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  const messages = async (client: OpencodeClient, sessionID: string) => {
    const result = await client.session.messages({ sessionID }, { throwOnError: true })
    return result.data ?? []
  }
  const hasAnswer = async (client: OpencodeClient, sessionID: string, text: string) => {
    const sessionMessages = await messages(client, sessionID)
    return sessionMessages.some((message) =>
      message.info.role === 'assistant' &&
      message.parts.some((part) => part.type === 'text' && part.text === text)
    )
  }

  it('persists prompts, streams replies, handles tools and aborts, and resumes after restart', { timeout: 120_000 }, async () => {
    const runtime = await runtimeManager.ensureRuntime(directory)
    expect(runtime.version).toBeTruthy()
    const probe = await runtime.client.session.create({ title: 'Saved prompt' }, { throwOnError: true })
    const probeID = probe.data!.id
    await runtime.client.session.prompt(
      { sessionID: probeID, noReply: true, parts: [{ type: 'text', text: 'saved prompt' }] },
      { throwOnError: true }
    )
    expect((await messages(runtime.client, probeID)).flatMap((message) => message.parts)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'text', text: 'saved prompt' })])
    )
    if (process.env.OPENCODE_EXPECT_COMPAT) {
      expect(runtime.messagePersistenceCompat).toBe(process.env.OPENCODE_EXPECT_COMPAT === '1')
    }
    await runtime.client.session.delete({ sessionID: probeID }, { throwOnError: true })
    expect(
      (await runtime.client.session.list()).data?.some((session) => session.title === 'OCO compatibility check')
    ).toBe(false)

    bridge = new EventBridge(runtime.id, directory, runtime.client, (event) => events.push(event))
    await bridge.start()
    const stream = await agentController.launchAgent({ directory, model: 'compat/compat', prompt: 'compat-stream' })
    await until(() => hasAnswer(runtime.client, stream.sessionId, 'STREAM_OK'))
    expect(requests.some((request) =>
      request.some((message) => message.role === 'user' && JSON.stringify(message.content).includes('compat-stream'))
    )).toBe(true)
    await until(() => events.some((event) => event.type === 'message.part.delta'))

    const permission = await agentController.launchAgent({ directory, model: 'compat/compat', prompt: 'compat-permission' })
    let permissionID: string | undefined
    await until(async () => {
      const result = await runtime.client.permission.list({ directory }, { throwOnError: true })
      permissionID = result.data?.find((request) => request.sessionID === permission.sessionId)?.id
      return !!permissionID
    })
    await agentController.respondToPermission(permission.id, permissionID!, 'once')
    await until(() => hasAnswer(runtime.client, permission.sessionId, 'PERMISSION_OK'))
    expect(readFileSync(join(directory, 'hello.txt'), 'utf8')).toBe('hello world')
    expect((await messages(runtime.client, permission.sessionId)).flatMap((message) => message.parts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool',
          tool: 'write',
          state: expect.objectContaining({ status: 'completed' })
        })
      ])
    )

    const question = await agentController.launchAgent({ directory, model: 'compat/compat', prompt: 'compat-question' })
    let questionID: string | undefined
    await until(async () => {
      const result = await runtime.client.question.list({ directory }, { throwOnError: true })
      questionID = result.data?.find((request) => request.sessionID === question.sessionId)?.id
      return !!questionID
    })
    await agentController.replyToQuestion(question.id, questionID!, [['Blue']])
    await until(() => hasAnswer(runtime.client, question.sessionId, 'QUESTION_OK'))
    expect(requests.some((request) =>
      request.some((message) => message.role === 'tool' && JSON.stringify(message.content).includes('Blue'))
    )).toBe(true)

    const hang = await agentController.launchAgent({ directory, model: 'compat/compat', prompt: 'compat-hang' })
    await until(() => held.size > 0)
    expect((await runtime.client.session.status()).data?.[hang.sessionId]?.type).toBe('busy')
    await agentController.abortAgent(hang.id)
    await until(async () => (await runtime.client.session.status()).data?.[hang.sessionId]?.type !== 'busy')
    expect(events.filter((event) =>
      event.type === 'session.error' && JSON.stringify(event.properties).includes('MessageAbortedError') === false
    )).toEqual([])

    bridge.stop()
    agentController.removeAgent(stream.id)
    await runtimeManager.stopRuntime(runtime.id)
    const resumed = await agentController.resumeAgent({ directory, sessionId: stream.sessionId })
    const restarted = runtimeManager.getRuntime(resumed.runtimeId)!
    expect(await hasAnswer(restarted.client, stream.sessionId, 'STREAM_OK')).toBe(true)
    await agentController.sendMessage(resumed.id, 'compat-resume')
    await until(() => hasAnswer(restarted.client, stream.sessionId, 'RESUME_OK'))
    expect(requests.some((request) =>
      request.some((message) => message.role === 'assistant' && JSON.stringify(message.content).includes('STREAM_OK')) &&
      request.some((message) => message.role === 'user' && JSON.stringify(message.content).includes('compat-resume'))
    )).toBe(true)
  })
})
