/* ------------------------------------------------------------------------- *
 * Where a terminal command runs when no folder is open.
 *
 * The terminal is not a file tool: a user who says "go to the terminal and run
 * a harmless test command" expects it to work even in an empty IDE. Without a
 * workspace the honest default is the user's home folder — the same place a
 * freshly opened PowerShell starts in — rather than the failure "No workspace
 * is open", which used to leave the model retrying the same call.
 *
 * The workspace half of the rule stays in the main process, next to the sandbox
 * check that keeps a relative path inside the open project.
 * ------------------------------------------------------------------------- */

import { isAbsolute, resolve } from 'node:path'

/** The folder a command runs in without a workspace: home, or inside it. */
export function homeCwd(input: string, home: string): string {
  const trimmed = input.trim()
  if (trimmed.length === 0 || trimmed === '.') return home
  return isAbsolute(trimmed) ? resolve(trimmed) : resolve(home, trimmed)
}
