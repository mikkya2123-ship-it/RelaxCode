import type { DiffMeta } from '@shared/tool-meta'
import { getWorkspaceRoot } from './workspace'
import {
  argBool,
  argNumber,
  argString,
  execCapture,
  execToolResult,
  NO_WORKSPACE,
  relPath,
  resolveInWorkspace,
  shellQuote,
  ToolError,
  truncate,
  type ToolDef
} from './tool-utils'

/**
 * Git beyond status and diff: saving work (commit), reading history (log,
 * blame) and undoing uncommitted changes (restore). Branches are deliberately
 * out of scope for the agent.
 */

const gitCommitTool: ToolDef = {
  name: 'git_commit',
  description:
    'Stage changes and create a git commit with the given message. By default stages everything the workspace changed; pass paths to commit only some files. Run git_status or git_diff first, write the message yourself (concise, imperative, e.g. "Fix login redirect loop") and commit when a coherent piece of work is done. Never commit unless the user asked for the work to be committed.',
  parameters: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Commit message (one line, imperative)' },
      paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Workspace-relative paths to stage instead of everything'
      }
    },
    required: ['message']
  },
  risk: 'write',
  execute: async (args, ctx) => {
    const root = getWorkspaceRoot()
    if (!root) throw new ToolError(NO_WORKSPACE)
    const message = argString(args, 'message').slice(0, 500)
    const rawPaths = Array.isArray(args.paths) ? args.paths : []
    const paths = rawPaths.filter((path): path is string => typeof path === 'string').map(resolveInWorkspace)

    const staged = paths.length > 0 ? `git add -- ${paths.map((p) => shellQuote(relPath(p))).join(' ')}` : 'git add -A'
    const add = await execCapture(staged, root, ctx.signal)
    if (!add.ok) return { ok: false, summary: 'git add failed', detail: truncate(add.output) }

    const commit = await execCapture(`git commit -m ${shellQuote(message)}`, root, ctx.signal)
    if (!commit.ok) {
      return {
        ok: false,
        summary: 'git commit failed',
        detail: truncate([commit.output, 'Hint: "nothing to commit" means the changes were already committed.'].join('\n'))
      }
    }
    const stat = await execCapture('git show --stat --oneline HEAD', root, ctx.signal)
    return {
      ok: true,
      summary: `committed: ${message.split('\n')[0]}`,
      detail: truncate([commit.output, stat.output].filter(Boolean).join('\n')),
      meta: { kind: 'diff', title: message.split('\n')[0], patch: stat.output } satisfies DiffMeta
    }
  }
}

const gitLogTool: ToolDef = {
  name: 'git_log',
  description:
    'Show the commit history of the workspace or of one file: short hash, date, author, message. Use it to understand what was done recently or when a file last changed.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Limit history to this workspace file' },
      limit: { type: 'number', description: 'How many commits to show (default 20, max 100)' }
    }
  },
  risk: 'read',
  execute: async (args, ctx) => {
    const root = getWorkspaceRoot()
    if (!root) throw new ToolError(NO_WORKSPACE)
    const limit = Math.min(Math.max(argNumber(args, 'limit') ?? 20, 1), 100)
    let command = `git log -n ${limit} --date=short --pretty=format:"%h %ad %an %s"`
    const scope = argString(args, 'path', false)
    if (scope) command += ` -- "${relPath(resolveInWorkspace(scope))}"`
    const result = await execToolResult(command, root, ctx.signal)
    return { ...result, summary: result.ok ? `last ${limit} commits` : result.summary }
  }
}

const gitRestoreTool: ToolDef = {
  name: 'git_restore',
  description:
    "Undo uncommitted changes to a file by restoring it from the last commit. This DISCARDS the file's current edits — they are gone for good; there is no undo. Use it when the user asks to revert a file, or after showing them what would be lost. Always run git_diff on the file first.",
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace file to restore' },
      unstage: {
        type: 'boolean',
        description: 'Only remove the file from the staging area, keep its edits (safe)'
      }
    },
    required: ['path']
  },
  risk: 'delete',
  execute: async (args, ctx) => {
    const root = getWorkspaceRoot()
    if (!root) throw new ToolError(NO_WORKSPACE)
    const path = relPath(resolveInWorkspace(argString(args, 'path')))
    const command = argBool(args, 'unstage')
      ? `git restore --staged -- "${path}"`
      : `git restore -- "${path}"`
    const result = await execToolResult(command, root, ctx.signal)
    return {
      ...result,
      summary: result.ok
        ? argBool(args, 'unstage')
          ? `unstaged ${path}`
          : `restored ${path} to last commit`
        : result.summary
    }
  }
}

const gitBlameTool: ToolDef = {
  name: 'git_blame',
  description:
    'Show who last changed each line of a file and in which commit (short hash, date, author). Pass a single line number to blame just that line.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace file to blame' },
      line: { type: 'number', description: 'Blame only this line number' }
    },
    required: ['path']
  },
  risk: 'read',
  execute: async (args, ctx) => {
    const root = getWorkspaceRoot()
    if (!root) throw new ToolError(NO_WORKSPACE)
    const path = relPath(resolveInWorkspace(argString(args, 'path')))
    const line = argNumber(args, 'line')
    const range = line && line > 0 ? ` -L ${line},${line}` : ''
    const result = await execToolResult(
      `git blame --date=short${range} -- "${path}"`,
      root,
      ctx.signal
    )
    return { ...result, summary: result.ok ? `git blame ${path}${range}` : result.summary }
  }
}

export const GIT_TOOLS: ToolDef[] = [gitCommitTool, gitLogTool, gitRestoreTool, gitBlameTool]
