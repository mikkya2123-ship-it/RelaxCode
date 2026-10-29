/**
 * Weak models get stuck: they repeat the call that just failed, word for word,
 * even after the tool told them why it failed. Those repeats cost a step, a
 * round-trip and, on a slow free provider, minutes of retries. This decides
 * when an identical call cannot produce a new answer.
 */

/** Tools whose success changes the workspace; anything else only reads it. */
export const MUTATING_TOOLS: ReadonlySet<string> = new Set([
  'write_file',
  'edit_file',
  'delete_path',
  'move_path',
  'git_commit',
  'git_restore',
  'format_code',
  'install_package',
  'snapshot_project'
])

export interface CallMemory {
  attempts: number
  ok: boolean
  /** Counter of successful mutations at the moment the call finished. */
  mutations: number
}

/** Identity of a call: the same tool with the same arguments, byte for byte. */
export function callSignature(name: string, args: string): string {
  return `${name}\u0000${args.trim()}`
}

/**
 * True when running this call again cannot answer anything new:
 * - it already failed and nothing has changed since (the usual loop), or
 * - it already ran twice with nothing changed since, or
 * - it is a mutation that already succeeded and nothing has changed since.
 *
 * A retest after an edit is allowed: the edit moved the mutation counter.
 */
export function repeatBlock(
  memory: CallMemory | undefined,
  mutations: number,
  tool: string
): boolean {
  if (!memory) return false
  if (memory.mutations !== mutations) return false
  if (!memory.ok) return true
  if (memory.attempts >= 2) return true
  return MUTATING_TOOLS.has(tool)
}

/** Model-facing explanation for a call that was skipped instead of repeated. */
export function repeatNotice(tool: string, memory: CallMemory): string {
  const outcome = memory.ok ? 'succeeded' : 'failed'
  // Terminal calls have nothing to re-read: the fix is a different command or a
  // different folder, not another look at a file.
  const advice =
    tool === 'run_command' || tool === 'start_server'
      ? 'Change the command (or the cwd) before running it again, or tell the user what blocks you.'
      : 'Read the file again to see its current contents, change the arguments, or tell the user what blocks you.'
  return (
    `This exact ${tool} call (identical arguments) already ran ${memory.attempts} time(s) and ${outcome}, ` +
    `and nothing changed since. Running it again returns the same result. ${advice}`
  )
}
