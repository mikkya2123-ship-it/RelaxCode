import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { LogLevel } from '@shared/settings'
import { getSettings } from './store'

const ORDER: LogLevel[] = ['error', 'warn', 'info', 'debug']

/** `<userData>/relaxcode.log`, next to `settings.json`. */
export function logFilePath(): string {
  return join(app.getPath('userData'), 'relaxcode.log')
}

/**
 * Writes to the log file when the configured level allows it. Logging must
 * never be the reason the IDE crashes, so every failure is swallowed.
 */
export function logEvent(level: LogLevel, message: string): void {
  let configured: LogLevel = 'error'
  try {
    configured = getSettings().notifications.logLevel
  } catch {
    // Settings may not be readable yet (very early startup): keep the default.
  }
  if (ORDER.indexOf(level) > ORDER.indexOf(configured)) return

  const line = `[${new Date().toISOString()}] ${level}: ${message}\n`
  if (level === 'error' || level === 'warn') console.error(line.trimEnd())
  else console.log(line.trimEnd())

  try {
    appendFileSync(logFilePath(), line)
  } catch {
    // best effort
  }
}
