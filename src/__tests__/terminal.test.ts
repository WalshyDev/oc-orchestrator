import { describe, it, expect } from 'vitest'
import { shellQuote, appleScriptQuote, buildTerminalTabScript } from '../main/terminal'

describe('shellQuote', () => {
  it('wraps a plain path in single quotes', () => {
    expect(shellQuote('/Users/me/repo')).toBe("'/Users/me/repo'")
  })

  it('keeps spaces inside the quoted word', () => {
    expect(shellQuote('/Users/me/My Repo')).toBe("'/Users/me/My Repo'")
  })

  it('closes and reopens the quote around an embedded apostrophe', () => {
    // Worktrees under a directory like "Will's projects" would otherwise
    // terminate the shell word early and run the remainder as a command.
    expect(shellQuote("/Users/me/Will's repo")).toBe("'/Users/me/Will'\\''s repo'")
  })

  it('leaves shell metacharacters inert', () => {
    expect(shellQuote('/tmp/a;rm -rf b$(x)`y`')).toBe("'/tmp/a;rm -rf b$(x)`y`'")
  })
})

describe('appleScriptQuote', () => {
  it('wraps a plain string in double quotes', () => {
    expect(appleScriptQuote('cd /tmp')).toBe('"cd /tmp"')
  })

  it('escapes backslashes before double quotes so the pair cannot invert', () => {
    expect(appleScriptQuote('a\\b')).toBe('"a\\\\b"')
    expect(appleScriptQuote('say "hi"')).toBe('"say \\"hi\\""')
    expect(appleScriptQuote('a\\"b')).toBe('"a\\\\\\"b"')
  })

  it('escapes line breaks that would terminate the literal', () => {
    expect(appleScriptQuote('a\nb')).toBe('"a\\nb"')
    expect(appleScriptQuote('a\r\nb')).toBe('"a\\r\\nb"')
  })
})

describe('buildTerminalTabScript', () => {
  it('cds into the path and targets the front window tab', () => {
    const script = buildTerminalTabScript('/Users/me/repo')
    expect(script).toContain('tell application "Terminal"')
    expect(script).toContain('keystroke "t" using command down')
    expect(script).toContain('do script "cd \'/Users/me/repo\'" in selected tab of front window')
  })

  it('opens a window instead when Terminal has none', () => {
    expect(buildTerminalTabScript('/tmp')).toContain('if (count of windows) is 0 then')
  })

  it('opens its own window when no tab appeared, rather than erroring', () => {
    // The cd must never land in whichever tab is selected — it may be running an
    // interactive program. Erroring instead would let a late tab and the caller's
    // fallback both open, giving the user two.
    const script = buildTerminalTabScript('/tmp')
    const elseBranch = script.slice(script.indexOf('if madeTab then'))
    const fallbackLine = elseBranch
      .split('\n')
      .find((line, i, lines) => i > lines.findIndex((l) => l.trim() === 'else') && line.includes('do script'))
    expect(fallbackLine).toBeDefined()
    // A bare `do script` opens a window; the tab form qualifies it with a target.
    expect(fallbackLine).not.toContain('in selected tab')
  })

  it('waits for Terminal to come forward before sending the keystroke', () => {
    // An early keystroke opens a tab in whatever app still holds focus.
    const script = buildTerminalTabScript('/tmp')
    const frontCheck = script.indexOf('if frontmost then')
    const keystroke = script.indexOf('keystroke "t"')
    expect(frontCheck).toBeGreaterThan(-1)
    expect(frontCheck).toBeLessThan(keystroke)
  })

  it('survives a path containing both an apostrophe and a backslash', () => {
    const script = buildTerminalTabScript("/tmp/o'brien\\x")
    // Single quote closed/reopened for the shell, backslash doubled for AppleScript.
    expect(script).toContain('cd \'/tmp/o\'\\\\\'\'brien\\\\x\'')
  })
})
