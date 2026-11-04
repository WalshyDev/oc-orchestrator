import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const moduleUrl = pathToFileURL(resolve('scripts/session-identity.mjs')).href
const { default: sessionIdentity } = await import(moduleUrl)

describe('session identity plugin', () => {
  it('keeps concurrent shell calls separate and overrides inherited identities', async () => {
    const hooks = await sessionIdentity()
    const first = { env: { OPENCODE_SESSION_ID: 'stale', OCO_SESSION_ID: 'parent', CUSTOM: 'keep' } }
    const second = { env: { OPENCODE_SESSION_ID: 'stale', OCO_SESSION_ID: 'parent' } }
    await Promise.all([
      hooks['shell.env']({ cwd: '/shared', sessionID: 'ses_first' }, first),
      hooks['shell.env']({ cwd: '/shared', sessionID: 'ses_second' }, second)
    ])
    expect(first.env).toEqual({ OPENCODE_SESSION_ID: 'ses_first', OCO_SESSION_ID: 'ses_first', CUSTOM: 'keep' })
    expect(second.env).toEqual({ OPENCODE_SESSION_ID: 'ses_second', OCO_SESSION_ID: 'ses_second' })
  })

  it('clears identities when OpenCode supplies no session', async () => {
    const hooks = await sessionIdentity()
    const output = { env: { OPENCODE_SESSION_ID: 'parent', OCO_SESSION_ID: 'parent' } }
    await hooks['shell.env']({ cwd: '/shared' }, output)
    expect(output.env).toEqual({ OPENCODE_SESSION_ID: '', OCO_SESSION_ID: '' })
    const context = { system: ['Existing instructions'] }
    await hooks['experimental.chat.system.transform']({}, context)
    expect(context.system).toEqual(['Existing instructions'])
  })

  it('reads the session from each hook invocation and preserves other context', async () => {
    const hooks = await sessionIdentity()
    for (const sessionID of ['ses_original', 'ses_fork', 'ses_reset']) {
      const output = { system: ['Existing instructions'] }
      await hooks['experimental.chat.system.transform']({ sessionID }, output)
      expect(output.system[0]).toBe('Existing instructions')
      expect(output.system[1]).toContain(`Your current OpenCode session ID is "${sessionID}".`)
      expect(output.system[1]).toContain('missing, stale, or ambiguous')
    }
  })
})
