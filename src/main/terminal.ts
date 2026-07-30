/** Wraps a path for use inside a POSIX single-quoted shell word. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

/**
 * Escapes a string for embedding in an AppleScript string literal. Line breaks
 * are escaped too — a raw one would terminate the literal and break the script.
 */
export function appleScriptQuote(value: string): string {
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')}"`
}

/**
 * Builds AppleScript that opens `path` in a new Terminal.app tab of the
 * existing window, falling back to a new window when Terminal has none open.
 *
 * Terminal.app's dictionary has no "create tab" command — `do script` on its
 * own always spawns a window. The only way to get a tab is the Cmd+T keystroke
 * via System Events, which needs Accessibility permission. The script opens a
 * window itself if the tab never appears, so it only throws when System Events
 * refuses outright; callers should treat that as a signal to fall back to plain
 * `open -a`.
 */
export function buildTerminalTabScript(path: string): string {
  const command = appleScriptQuote(`cd ${shellQuote(path)}`)
  return `
tell application "Terminal"
  activate
  if (count of windows) is 0 then
    do script ${command}
  else
    -- Wait for Terminal to actually come forward rather than guessing a delay:
    -- a keystroke sent early lands in whichever app still holds focus, leaving a
    -- stray tab in the user's editor or browser.
    set isFront to false
    repeat 20 times
      if frontmost then
        set isFront to true
        exit repeat
      end if
      delay 0.05
    end repeat
    if not isFront then error "Terminal did not come to the front"
    -- Two ways a new tab shows up, depending on the macOS version. Terminal now
    -- uses the system's window tab groups, where each tab is a separate window to
    -- AppleScript, so the front window id changes and its tab count stays at 1.
    -- Older releases add the tab to the same window, where only the count moves.
    set frontBefore to id of front window
    set tabsBefore to count of tabs of front window
    tell application "System Events" to keystroke "t" using command down
    set madeTab to false
    repeat 40 times
      if ((id of front window) is not frontBefore) or ((count of tabs of front window) > tabsBefore) then
        set madeTab to true
        exit repeat
      end if
      delay 0.05
    end repeat
    if madeTab then
      do script ${command} in selected tab of front window
    else
      -- Never cd in whatever tab was already selected: it could be sitting in
      -- vim or a psql session. Open a window instead, and do it here rather than
      -- erroring out — a late-arriving tab plus a caller-side fallback would
      -- leave the user with two.
      do script ${command}
    end if
  end if
end tell`
}
