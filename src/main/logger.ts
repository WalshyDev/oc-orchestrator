import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { inspect } from 'node:util'

type ConsoleMethod = 'debug' | 'info' | 'log' | 'warn' | 'error'

const LOG_DIR = join(homedir(), '.oc-orchestrator')
export const latestLogPath = join(LOG_DIR, 'latest.log')

const originalConsole: Record<ConsoleMethod, (...data: unknown[]) => void> = {
  debug: console.debug.bind(console),
  info: console.info.bind(console),
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console)
}

let logFileAvailable = false

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`
  return inspect(value, { colors: false, depth: 8, breakLength: 140 })
}

function writeLogEntry(level: string, args: unknown[]): void {
  if (!logFileAvailable) return

  const message = args.map(formatValue).join(' ')
  appendFileSync(latestLogPath, `${new Date().toISOString()} ${level} ${message}\n`)
}

function patchConsole(method: ConsoleMethod, level: string): void {
  console[method] = (...args: unknown[]) => {
    try {
      writeLogEntry(level, args)
    } catch (error) {
      logFileAvailable = false
      originalConsole.error('[Logger] Failed to write log entry:', error)
    }

    originalConsole[method](...args)
  }
}

try {
  mkdirSync(LOG_DIR, { recursive: true })
  writeFileSync(latestLogPath, `${new Date().toISOString()} INFO [Logger] Log started at ${latestLogPath}\n`)
  logFileAvailable = true
} catch (error) {
  originalConsole.error('[Logger] Failed to initialize log file:', error)
}

patchConsole('debug', 'DEBUG')
patchConsole('info', 'INFO')
patchConsole('log', 'INFO')
patchConsole('warn', 'WARN')
patchConsole('error', 'ERROR')

console.info(`[Logger] Writing logs to ${latestLogPath}`)

process.on('uncaughtExceptionMonitor', (error) => {
  console.error('[Process] Uncaught exception:', error)
})

process.on('unhandledRejection', (reason) => {
  console.error('[Process] Unhandled rejection:', reason)
})
