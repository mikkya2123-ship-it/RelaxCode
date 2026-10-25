import { existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import { getWorkspaceRoot } from './workspace'
import {
  argBool,
  argString,
  execCapture,
  NO_WORKSPACE,
  relPath,
  resolveInWorkspace,
  shellQuote,
  ToolError,
  truncate,
  type ToolDef
} from './tool-utils'

/**
 * The self-check tools: the agent runs the project's own tests, linters,
 * type checkers and dependency checks, so "done" means verified rather than
 * hopefully correct. Everything here shells out to the project's own tools —
 * nothing is installed silently (npx --no-install refuses to download).
 */

interface ProjectKind {
  npm: boolean
  python: boolean
  go: boolean
  rust: boolean
}

async function detectProject(root: string): Promise<ProjectKind> {
  const has = (path: string): boolean => existsSync(join(root, path))
  let scripts: Record<string, unknown> = {}
  try {
    const pkg = JSON.parse(await fs.readFile(join(root, 'package.json'), 'utf8'))
    if (pkg && typeof pkg === 'object') scripts = (pkg as { scripts?: Record<string, unknown> }).scripts ?? {}
  } catch {
    // no package.json — the flags below stay false
  }
  return {
    npm: Object.keys(scripts).length > 0 || has('package.json'),
    python: has('requirements.txt') || has('pyproject.toml') || has('setup.py'),
    go: has('go.mod'),
    rust: has('Cargo.toml')
  }
}

/** Reads package.json scripts, tolerating a missing or broken file. */
async function npmScripts(root: string): Promise<Record<string, string>> {
  try {
    const pkg = JSON.parse(await fs.readFile(join(root, 'package.json'), 'utf8'))
    const scripts = (pkg as { scripts?: Record<string, string> }).scripts
    return scripts && typeof scripts === 'object' ? scripts : {}
  } catch {
    return {}
  }
}

function testSummary(output: string): string {
  const passed = /(\d+)\s+passed/i.exec(output)?.[1]
  const failed = /(\d+)\s+failed/i.exec(output)?.[1]
  const skipped = /(\d+)\s+skipped/i.exec(output)?.[1]
  const errored = /(\d+)\s+error(s)?\b/i.exec(output)?.[1]
  const parts = [
    passed ? `${passed} passed` : '',
    failed ? `${failed} failed` : '',
    skipped ? `${skipped} skipped` : '',
    errored ? `${errored} errors` : ''
  ].filter(Boolean)
  if (parts.length > 0) return parts.join(', ')
  const goFail = (output.match(/--- FAIL:/g) ?? []).length
  if (goFail > 0) return `${goFail} failed`
  return ''
}

function tail(text: string, lines: number): string {
  const all = text.split('\n')
  return all.length <= lines ? text : `[… first ${all.length - lines} lines omitted]\n${all.slice(-lines).join('\n')}`
}

const runTestsTool: ToolDef = {
  name: 'run_tests',
  description:
    "Run the project's test suite and report the summary (passed/failed) with the failing output. Detects the runner itself: npm test / vitest / jest, pytest, go test, cargo test. Use it after changing code — a fix is not done until the tests pass. For a single file or test name pass `filter`.",
  parameters: {
    type: 'object',
    properties: {
      filter: {
        type: 'string',
        description: 'Optional file path or test-name substring to run only some tests'
      }
    }
  },
  risk: 'exec',
  execute: async (args, ctx) => {
    const root = getWorkspaceRoot()
    if (!root) throw new ToolError(NO_WORKSPACE)
    const filter = argString(args, 'filter', false)
    const kind = await detectProject(root)
    const scripts = await npmScripts(root)

    let command: string | null = null
    const hasTestScript = typeof scripts.test === 'string' && !scripts.test.includes('no test specified')
    if (kind.npm && (hasTestScript || existsSync(join(root, 'vitest.config.ts')) || existsSync(join(root, 'jest.config.js')))) {
      command = 'npm test --silent'
      if (filter) command += ` -- ${shellQuote(filter)}`
    } else if (kind.python) {
      command = 'python -m pytest'
      if (filter) command += ` ${shellQuote(filter)}`
    } else if (kind.go) {
      command = 'go test ./...'
    } else if (kind.rust) {
      command = 'cargo test'
    }
    if (!command) {
      return {
        ok: false,
        summary: 'no test runner found',
        detail:
          'No package.json test script, vitest/jest config, pytest, go test or cargo test detected in this project.'
      }
    }

    const outcome = await execCapture(command, root, ctx.signal, 300000)
    const summary = testSummary(outcome.output)
    return {
      ok: outcome.ok,
      summary: `${command}${summary ? ` — ${summary}` : ''}`,
      detail: truncate(tail(outcome.output, 80) || '(no output)')
    }
  }
}

const typeCheckTool: ToolDef = {
  name: 'type_check',
  description:
    "Run the project's type checker (tsc for TypeScript, mypy for Python) and report type errors with file and line. Use it before claiming code is fixed.",
  parameters: { type: 'object', properties: {} },
  risk: 'exec',
  execute: async (_args, ctx) => {
    const root = getWorkspaceRoot()
    if (!root) throw new ToolError(NO_WORKSPACE)
    const kind = await detectProject(root)
    let command: string | null = null
    if (existsSync(join(root, 'tsconfig.json'))) command = 'npx --no-install tsc --noEmit'
    else if (kind.python && existsSync(join(root, 'pyproject.toml'))) command = 'python -m mypy .'
    if (!command) {
      return { ok: false, summary: 'no type checker found', detail: 'No tsconfig.json or Python project with mypy detected.' }
    }
    const outcome = await execCapture(command, root, ctx.signal, 240000)
    return {
      ok: outcome.ok,
      summary: outcome.ok ? 'no type errors' : 'type errors found',
      detail: truncate(tail(outcome.output, 60) || '(no output)')
    }
  }
}

const lintCheckTool: ToolDef = {
  name: 'lint_check',
  description:
    "Run the project's linter (ESLint or Ruff) and report warnings and errors with file and line. Catches unused variables, style violations and suspicious patterns the type checker misses.",
  parameters: { type: 'object', properties: {} },
  risk: 'exec',
  execute: async (_args, ctx) => {
    const root = getWorkspaceRoot()
    if (!root) throw new ToolError(NO_WORKSPACE)
    const eslint =
      existsSync(join(root, 'eslint.config.js')) ||
      existsSync(join(root, 'eslint.config.mjs')) ||
      existsSync(join(root, '.eslintrc.json')) ||
      existsSync(join(root, '.eslintrc'))
    const ruff =
      existsSync(join(root, 'ruff.toml')) ||
      existsSync(join(root, '.ruff.toml')) ||
      existsSync(join(root, 'pyproject.toml'))
    let command: string | null = null
    if (eslint) command = 'npx --no-install eslint .'
    else if (ruff) command = 'python -m ruff check .'
    if (!command) {
      return { ok: false, summary: 'no linter found', detail: 'No ESLint or Ruff configuration detected in this project.' }
    }
    const outcome = await execCapture(command, root, ctx.signal, 240000)
    return {
      ok: outcome.ok,
      summary: outcome.ok ? 'no lint problems' : 'lint problems found',
      detail: truncate(tail(outcome.output, 60) || '(no output)')
    }
  }
}

const formatCodeTool: ToolDef = {
  name: 'format_code',
  description:
    "Format files with the project's own formatter (Prettier for web projects, Black for Python) and report what changed. Only runs a formatter that is already installed in the project.",
  parameters: {
    type: 'object',
    properties: {
      paths: { type: 'array', items: { type: 'string' }, description: 'Workspace files to format (default: everything)' }
    }
  },
  risk: 'write',
  execute: async (args, ctx) => {
    const root = getWorkspaceRoot()
    if (!root) throw new ToolError(NO_WORKSPACE)
    const raw = Array.isArray(args.paths) ? args.paths : []
    const targets =
      raw.length > 0
        ? raw.filter((path): path is string => typeof path === 'string').map((p) => shellQuote(relPath(resolveInWorkspace(p)))).join(' ')
        : '.'
    const prettierBin = join(root, 'node_modules', '.bin', existsSync(join(root, 'node_modules', '.bin', 'prettier.cmd')) ? 'prettier.cmd' : 'prettier')
    let command: string | null = null
    if (existsSync(prettierBin)) command = `npx --no-install prettier --write ${targets}`
    else if (existsSync(join(root, 'pyproject.toml')) || existsSync(join(root, 'requirements.txt'))) {
      command = `python -m black ${targets}`
    }
    if (!command) {
      return {
        ok: false,
        summary: 'no formatter found',
        detail: 'Prettier is not installed in this project (node_modules/.bin/prettier) and no Python project was detected.'
      }
    }
    const outcome = await execCapture(command, root, ctx.signal, 180000)
    return {
      ok: outcome.ok,
      summary: outcome.ok ? 'formatted' : 'formatter failed',
      detail: truncate(tail(outcome.output, 40) || '(no output)')
    }
  }
}

const depsCheckTool: ToolDef = {
  name: 'deps_check',
  description:
    "Check the project's dependencies: which packages are outdated and which have known security vulnerabilities (npm outdated + npm audit). Use it when the user asks about updates or before a big upgrade.",
  parameters: { type: 'object', properties: {} },
  risk: 'exec',
  execute: async (_args, ctx) => {
    const root = getWorkspaceRoot()
    if (!root) throw new ToolError(NO_WORKSPACE)
    if (!existsSync(join(root, 'package.json'))) {
      return { ok: false, summary: 'not an npm project', detail: 'No package.json — dependency checks currently support npm projects only.' }
    }
    // npm outdated exits 1 when anything IS outdated, so ok=false is normal here.
    const outdated = await execCapture('npm outdated', root, ctx.signal, 120000)
    const audit = await execCapture('npm audit --omit=dev', root, ctx.signal, 120000)
    const report = [
      outdated.output.trim() === '' ? 'All packages are up to date.' : `Outdated packages:\n${outdated.output}`,
      audit.output.trim() === '' ? 'No known vulnerabilities in production dependencies.' : `Audit:\n${audit.output}`
    ].join('\n\n')
    const vulnerable = (audit.output.match(/(\d+)\s+vulnerabilit/i) ?? [])[1]
    return {
      ok: true,
      summary: vulnerable ? `${vulnerable} vulnerabilities` : 'dependencies checked',
      detail: truncate(report)
    }
  }
}

const installPackageTool: ToolDef = {
  name: 'install_package',
  description:
    "Install a package into the project with its own package manager (npm for package.json, pip for Python). Pass plain package names, optionally with a version (`left-pad@2`). Ask before installing unless the user already named the package.",
  parameters: {
    type: 'object',
    properties: {
      packages: { type: 'array', items: { type: 'string' }, description: 'Package names to install' },
      dev: { type: 'boolean', description: 'Install as a development dependency (npm -D / pip --dev is not supported)' }
    },
    required: ['packages']
  },
  risk: 'exec',
  execute: async (args, ctx) => {
    const root = getWorkspaceRoot()
    if (!root) throw new ToolError(NO_WORKSPACE)
    const raw = Array.isArray(args.packages) ? args.packages : []
    const names = raw.filter((name): name is string => typeof name === 'string' && name.length > 0).slice(0, 20)
    if (names.length === 0) throw new ToolError('Missing required argument: packages')
    const quoted = names.map(shellQuote).join(' ')
    const kind = await detectProject(root)
    let command: string | null = null
    if (kind.npm) command = `npm install ${argBool(args, 'dev') ? '-D ' : ''}${quoted}`
    else if (kind.python) command = `pip install ${quoted}`
    if (!command) {
      return { ok: false, summary: 'no package manager detected', detail: 'Neither package.json nor a Python project file was found.' }
    }
    const outcome = await execCapture(command, root, ctx.signal, 600000)
    return {
      ok: outcome.ok,
      summary: outcome.ok ? `installed ${names.join(', ')}` : 'install failed',
      detail: truncate(tail(outcome.output, 40) || '(no output)')
    }
  }
}

const checkVersionsTool: ToolDef = {
  name: 'check_versions',
  description:
    "Compare installed package versions with the latest published ones: reads the project's package.json, asks the registry (npm view) and reports what would change. Use it before upgrading to see how far behind a dependency is.",
  parameters: {
    type: 'object',
    properties: {
      packages: {
        type: 'array',
        items: { type: 'string' },
        description: 'Package names to check (default: all dependencies)'
      }
    }
  },
  risk: 'exec',
  execute: async (args, ctx) => {
    const root = getWorkspaceRoot()
    if (!root) throw new ToolError(NO_WORKSPACE)
    let deps: Record<string, string> = {}
    try {
      const pkg = JSON.parse(await fs.readFile(join(root, 'package.json'), 'utf8'))
      deps = {
        ...((pkg as { dependencies?: Record<string, string> }).dependencies ?? {}),
        ...((pkg as { devDependencies?: Record<string, string> }).devDependencies ?? {})
      }
    } catch {
      return { ok: false, summary: 'no package.json', detail: 'Version checks currently support npm projects only.' }
    }
    const raw = Array.isArray(args.packages) ? args.packages : Object.keys(deps)
    const names = raw
      .filter((name): name is string => typeof name === 'string' && name in deps)
      .slice(0, 15)
    if (names.length === 0) return { ok: false, summary: 'nothing to check', detail: 'None of the named packages are in package.json.' }

    const lines: string[] = []
    for (const name of names) {
      if (ctx.signal.aborted) break
      const latest = await execCapture(`npm view ${shellQuote(name)} version`, root, ctx.signal, 30000)
      const installed = deps[name]
      const current = latest.ok ? latest.output.trim().split('\n').pop() ?? '' : 'unknown'
      const upToDate = current !== 'unknown' && installed.includes(current.replace(/^[^\d]*/, ''))
      lines.push(`${name}: installed ${installed} → latest ${current}${upToDate ? ' (up to date)' : ' (update available)'}`)
    }
    return { ok: true, summary: `${names.length} package(s) checked`, detail: lines.join('\n') }
  }
}

export const CHECK_TOOLS: ToolDef[] = [
  runTestsTool,
  typeCheckTool,
  lintCheckTool,
  formatCodeTool,
  depsCheckTool,
  installPackageTool,
  checkVersionsTool
]
