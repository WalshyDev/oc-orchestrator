export default async function sessionIdentity() {
  return {
    'shell.env': async (input, output) => {
      const sessionID = input.sessionID ?? ''
      output.env.OPENCODE_SESSION_ID = sessionID
      output.env.OCO_SESSION_ID = sessionID
    },
    'experimental.chat.system.transform': async (input, output) => {
      if (!input.sessionID) return
      output.system.push([
        `Your current OpenCode session ID is ${JSON.stringify(input.sessionID)}.`,
        'Shell tools expose this as OPENCODE_SESSION_ID and OCO_SESSION_ID.',
        'To address your own OCO fleet row, verify this exact session ID and the session directory against the live registry.',
        'If the row is missing, stale, or ambiguous, stop rather than choosing another session by workspace, title, or activity.',
        'An imported or forked transcript may contain an old session ID. Use the current ID above.'
      ].join('\n'))
    }
  }
}
