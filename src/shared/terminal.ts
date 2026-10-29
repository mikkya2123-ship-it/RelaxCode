/**
 * Terminal access, shared by the agent, the settings screen and the tests.
 *
 * The model may run any command it needs (installing packages, downloading
 * files, calling CLIs), but "any command" must not include wiping the machine.
 * `dangerousCommand` classifies a command line so the agent can refuse the
 * catastrophic ones outright and ask before the merely destructive ones. It is
 * a safety net, not a sandbox: it recognises the usual ways of destroying data,
 * it does not try to be a shell parser.
 */

export type TerminalShell = 'auto' | 'powershell' | 'cmd' | 'windows-terminal'

/** The shells offered in the settings screen, in display order. */
export const TERMINAL_SHELLS: readonly TerminalShell[] = [
  'auto',
  'powershell',
  'cmd',
  'windows-terminal'
]

export const DEFAULT_TERMINAL_SHELL: TerminalShell = 'auto'

export function isTerminalShell(value: unknown): value is TerminalShell {
  return typeof value === 'string' && (TERMINAL_SHELLS as readonly string[]).includes(value)
}

/** What a command is actually launched with on this machine. */
export type ResolvedShell = 'powershell' | 'cmd' | 'sh' | 'windows-terminal'

/**
 * The shell a command runs in. `auto` keeps the historical behaviour: cmd.exe
 * on Windows (commands written by older prompts keep working), sh elsewhere.
 * A per-command override wins over the setting; other platforms fall back to sh
 * because PowerShell and Windows Terminal are Windows-only.
 */
export function resolveTerminalShell(
  configured: TerminalShell | undefined,
  override: TerminalShell | undefined,
  platform: NodeJS.Platform = process.platform
): ResolvedShell {
  if (platform !== 'win32') return 'sh'
  const choice = isTerminalShell(override)
    ? override
    : isTerminalShell(configured)
      ? configured
      : 'auto'
  return choice === 'auto' ? 'cmd' : choice
}

/* ------------------------------------------------------------------------- *
 * "That is a Linux command, and this is cmd.exe."
 *
 * Weak models write `rm -rf`, `ls` or `cat` out of habit. cmd.exe answers "not
 * recognized as an internal or external command", the model guesses again, and
 * the user sees a run that only produces errors. Naming the Windows equivalent
 * in the tool result stops that loop better than any rule in the prompt.
 * ------------------------------------------------------------------------- */

const CMD_EQUIVALENTS: Record<string, string> = {
  rm: 'Delete with `del` for files or `rmdir /s /q` for folders — or use the delete_path tool',
  ls: 'List a folder with `dir` (or the list_dir tool)',
  cat: 'Print a file with `type` (or the read_file tool)',
  cp: 'Copy with `copy` or `xcopy`',
  mv: 'Move with `move`',
  touch: 'Create a file with the write_file tool (or `type nul > file`)',
  pwd: 'Show the current folder with `cd`',
  grep: 'Search text with `findstr`',
  which: 'Locate a program with `where`',
  ps: 'List processes with `tasklist`',
  kill: 'Stop a process with `taskkill /PID <pid> /T /F` (or the stop_server tool)',
  chmod: 'Windows has no POSIX permissions, so there is nothing to change here',
  chown: 'Windows has no POSIX owners, so there is nothing to change here',
  sudo: 'There is no sudo — ask the user to run an elevated command themselves',
  export: 'Set a variable with `set` (it only affects that one command line)',
  source: 'Run another script with `call`',
  head: 'Show the start of a file with `more`, or read it with the read_file tool',
  tail: 'Read the file with the read_file tool — there is no `tail` here',
  sed: 'Make the change with the edit_file tool — there is no `sed` here',
  awk: 'Do it in a node or python script — there is no `awk` here',
  clear: 'Clear the screen with `cls`',
  less: 'Read the file with the read_file tool instead of a pager',
  man: 'There is no manual page; use the tool help instead'
}

/**
 * A hint for a failed command that used a POSIX program under cmd.exe, or null
 * when the command is fine for this shell.
 */
export function windowsShellHint(command: string, shell: ResolvedShell): string | null {
  if (shell !== 'cmd') return null
  const first = command.trim().split(/[\s|;&]+/)[0] ?? ''
  const name = first
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^.*[\\/]/, '')
    .toLowerCase()
    .replace(/\.(?:exe|cmd|bat)$/, '')
  const equivalent = CMD_EQUIVALENTS[name]
  if (!equivalent) return null
  return `Hint: the shell is cmd.exe, not a Linux shell, so \`${name}\` does not exist here. ${equivalent}. Do not try \`${name}\` again — use the Windows form or the matching tool.`
}

export type DangerousLevel = 'destructive' | 'catastrophic'

/**
 * Stable codes for the destructive reasons. The English `reason` goes to the
 * model (it has to understand the refusal); the code lets the UI show the same
 * explanation in the user's language.
 */
export const DANGER_REASON_CODES = [
  'recursive',
  'recursiveFolder',
  'forceDelete',
  'folderContents',
  'untracked',
  'uncommitted',
  'database',
  'downloadedScript',
  'codeString'
] as const

export type DangerousReasonCode = (typeof DANGER_REASON_CODES)[number]

export interface DangerousCommand {
  level: DangerousLevel
  /** Short, model-facing explanation used in the refusal. */
  reason: string
  /** Set for destructive commands: tells the UI which sentence to show. */
  code?: DangerousReasonCode
}

/*
 * Catastrophic: damaging the machine itself or every user file on it. These are
 * refused even in full-auto mode (unless the user turns the protection off).
 */
const CATASTROPHIC: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bformat(?:\.com)?\s+[a-z]:/i, 'it formats a disk drive'],
  [/\bdiskpart\b/i, 'it repartitions disks'],
  [/\bbcdedit\b/i, 'it edits the boot configuration'],
  [/\bvssadmin\s+delete\b/i, 'it deletes shadow copies'],
  [/\bwbadmin\s+delete\b/i, 'it deletes system backups'],
  [/\bcipher(?:\.exe)?\s+\/w/i, 'it wipes free disk space'],
  [/\b(?:shutdown|logoff)(?:\.exe)?\b/i, 'it shuts down the computer'],
  [/\b(?:Restart-Computer|Stop-Computer)\b/i, 'it shuts down the computer'],
  [
    /\breg(?:\.exe)?\s+delete\s+(?:HKLM|HKEY_LOCAL_MACHINE)/i,
    'it deletes system registry keys'
  ],
  [
    /\bRemove-Item\b[^\n]*\b(?:C:\\Windows(?:\\[^\\\s"']+)?|C:\\Program Files(?: \(x86\))?|C:\\Users(?:\\[^\\\s"']+)?)(?:\\\*)?\\?["']?(?:\s|$)/i,
    'it deletes system folders'
  ],
  [
    /\bRemove-Item\b[^\n]*(?:\b[a-z]:[\\/]|\$env:USERPROFILE[\\/]?|\$HOME[\\/]?)(?:\*)?["']?(?:\s|$)/i,
    'it deletes a whole drive or the home folder'
  ],
  [
    /\b(?:rd|rmdir|del|erase)\b[^\n]*\b[a-z]:[\\/](?:\*|\*\.\*)?["']?(?:\s|$)/i,
    'it deletes a whole drive'
  ],
  [/\b(?:Clear-Disk|Initialize-Disk|Remove-Partition|Format-Volume)\b/i, 'it wipes a disk'],
  [
    /\b(?:rd|rmdir|del|erase)\b[^\n]*\b(?:C:\\Windows(?:\\[^\\\s"']+)?|C:\\Program Files(?: \(x86\))?|C:\\Users(?:\\[^\\\s"']+)?)(?:\\\*)?\\?["']?(?:\s|$)/i,
    'it deletes system folders'
  ],
  [
    /\brm\s+(?:-[a-z-]*\s+)*-(?:rf|fr)\s+(?:\/|~|\$HOME|%USERPROFILE%)(?:\s|$)/i,
    'it deletes the home or root directory'
  ],
  [
    /\brm\s+-[a-z]*r[a-z]*\s+(?:\/|~|\$HOME|%USERPROFILE%)(?:\s|$)/i,
    'it deletes the home or root directory'
  ],
  [/\bmkfs(?:\.\w+)?\b/i, 'it formats a filesystem'],
  [/\bdd\b[^\n]*\bof=\/dev\/(?:sd|nvme|disk)/i, 'it overwrites a disk'],
  [
    /\b(?:Disable-WindowsOptionalFeature|Remove-WindowsFeature)\b/i,
    'it removes Windows components'
  ]
]

/*
 * Destructive: it can throw away the user's work, but the target is usually a
 * folder inside the project (node_modules, dist, a scratch directory). A normal
 * approval run already asks; in auto modes this list forces one extra question.
 */
const DESTRUCTIVE: ReadonlyArray<readonly [RegExp, string, DangerousReasonCode]> = [
  [/\brm\s+-[a-z]*r[a-z]*/i, 'it deletes files recursively', 'recursive'],
  [/\b(?:rd|rmdir)\s+\/s/i, 'it deletes folders recursively', 'recursiveFolder'],
  [/\b(?:del|erase)\b[^\n]*\/[a-z]*[sf]/i, 'it force-deletes files', 'forceDelete'],
  [/\bRemove-Item\b[^\n]*-Recurse/i, 'it deletes files recursively', 'recursive'],
  [/\brm\s+-[a-z]*[rf][a-z]*\s+(?:\.|\*|\*\.\*)(?:\s|$)/i, 'it deletes the contents of a folder', 'folderContents'],
  [/\bgit\s+clean\b[^\n]*\s-[a-z]*[fdx]/i, 'it removes untracked files and folders', 'untracked'],
  [/\bgit\s+reset\s+--hard\b/i, 'it discards uncommitted changes', 'uncommitted'],
  [/\bgit\s+checkout\s+(?:--\s+)?\.\s*$/i, 'it discards uncommitted changes', 'uncommitted'],
  [/\b(?:DROP\s+(?:DATABASE|TABLE)|TRUNCATE\s+TABLE)\b/i, 'it drops database data', 'database'],
  [/\b(?:curl|wget)\b[^\n]*\|\s*(?:ba|z|k)?sh\b/i, 'it runs a downloaded script', 'downloadedScript'],
  [
    /\b(?:iwr|Invoke-WebRequest|Invoke-RestMethod)\b[^\n]*\|\s*(?:iex|Invoke-Expression)\b/i,
    'it runs a downloaded script',
    'downloadedScript'
  ],
  [/\b(?:iex|Invoke-Expression)\s*\(/i, 'it executes a string as code', 'codeString']
]

/** The worst thing this command line would do, or null when it looks ordinary. */
export function dangerousCommand(command: string): DangerousCommand | null {
  const text = command.trim()
  if (text.length === 0) return null
  for (const [pattern, reason] of CATASTROPHIC) {
    if (pattern.test(text)) return { level: 'catastrophic', reason }
  }
  for (const [pattern, reason, code] of DESTRUCTIVE) {
    if (pattern.test(text)) return { level: 'destructive', reason, code }
  }
  return null
}
