import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import type {
  TeamEvent,
  TeamMe,
  TeamMember,
  TeamState,
  TeamTask,
  TeamTaskStatus
} from '@shared/team'
import { setAgentFileScope } from './tool-utils'
import { getWorkspaceRoot } from './workspace'

/**
 * The Friendly Development team: a roster of REAL people. The shared team
 * file (roster + tasks) lives in userData and is meant to be synced between
 * teammates through their GitHub repository. A separate local file stores
 * who works on this machine and their personal access token. The AI agent
 * that assists the local user knows their role, their open tasks and their
 * limits.
 */

const TEAM_FILE = () => join(app.getPath('userData'), 'team.json')
const ME_FILE = () => join(app.getPath('userData'), 'team-me.json')

let state: TeamState | null = null
let me: { memberId: string | null; tokenEnc: string | null } | null = null
let emit: ((event: TeamEvent) => void) | null = null

export function teamAssistActive(): boolean {
  const st = ensureLoaded()
  const meFile = loadMe()
  return !!meFile.memberId && st.members.some((m) => m.id === meFile.memberId)
}

function publicState(full: TeamState): TeamState {
  return { ...full, github: { ...full.github, tokenEnc: full.github.tokenEnc ? 'set' : null } }
}

function ensureLoaded(): TeamState {
  if (!state) {
    try {
      const raw = JSON.parse(readFileSync(TEAM_FILE(), 'utf8')) as Partial<TeamState>
      state = {
        name: raw.name ?? 'Наша команда',
        description: raw.description ?? '',
        members: Array.isArray(raw.members) ? raw.members : [],
        tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
        baseBranch: raw.baseBranch || 'main',
        github: raw.github ?? { owner: '', repo: '', tokenEnc: null }
      }
    } catch {
      state = {
        name: 'Наша команда',
        description: '',
        members: [],
        tasks: [],
        baseBranch: 'main',
        github: { owner: '', repo: '', tokenEnc: null }
      }
    }
  }
  return state
}

function loadMe(): { memberId: string | null; tokenEnc: string | null } {
  if (me) return me
  try {
    const raw = JSON.parse(readFileSync(ME_FILE(), 'utf8')) as Partial<TeamMe>
    me = { memberId: raw.memberId ?? null, tokenEnc: raw.tokenEnc ?? null }
  } catch {
    me = { memberId: null, tokenEnc: null }
  }
  return me
}

function saveAll(): void {
  try {
    writeFileSync(TEAM_FILE(), JSON.stringify(ensureLoaded(), null, 2), 'utf8')
  } catch {
    // Best effort.
  }
  try {
    writeFileSync(ME_FILE(), JSON.stringify(loadMe(), null, 2), 'utf8')
  } catch {
    // Best effort.
  }
}

function sendState(): void {
  if (!emit) return
  emit({ kind: 'state', state: publicState(ensureLoaded()) })
}

function log(line: string, level: 'info' | 'error' = 'info'): void {
  emit?.({ kind: 'log', line, level })
}

export function getTeamState(): TeamState {
  return publicState(ensureLoaded())
}

/** Saves the shared team file (roster, tasks, github repo coordinates). */
export function saveTeamState(next: TeamState): TeamState {
  const st = ensureLoaded()
  st.name = next.name ?? st.name
  st.description = next.description ?? st.description
  st.members = Array.isArray(next.members) ? next.members : st.members
  st.tasks = Array.isArray(next.tasks) ? next.tasks : st.tasks
  st.baseBranch = next.baseBranch || st.baseBranch
  st.github = {
    owner: next.github?.owner ?? st.github.owner,
    repo: next.github?.repo ?? st.github.repo,
    tokenEnc:
      next.github?.tokenEnc && next.github.tokenEnc !== 'set'
        ? next.github.tokenEnc
        : st.github.tokenEnc
  }
  saveAll()
  sendState()
  return getTeamState()
}

/** Stores who works on this machine and their personal token. */
export function setTeamMe(memberId: string | null, tokenPlain?: string): {
  memberId: string | null
  hasToken: boolean
} {
  const meFile = loadMe()
  meFile.memberId = memberId
  if (tokenPlain !== undefined) {
    if (tokenPlain.trim() === '') meFile.tokenEnc = null
    else if (safeStorage.isEncryptionAvailable())
      meFile.tokenEnc = safeStorage.encryptString(tokenPlain.trim()).toString('base64')
  }
  me = meFile
  try {
    writeFileSync(ME_FILE(), JSON.stringify(meFile, null, 2), 'utf8')
  } catch {
    // Best effort.
  }
  return { memberId: meFile.memberId, hasToken: !!meFile.tokenEnc }
}

export function getTeamMe(): { memberId: string | null; hasToken: boolean } {
  const meFile = loadMe()
  return { memberId: meFile.memberId, hasToken: !!meFile.tokenEnc }
}

/** Adds a task to the board (the lead, or any member for themselves). */
export function addTeamTask(task: {
  title: string
  description: string
  assigneeId: string
  createdBy: string
}): TeamTask {
  const st = ensureLoaded()
  const full: TeamTask = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    title: task.title.slice(0, 160),
    description: task.description.slice(0, 4000),
    assigneeId: task.assigneeId,
    createdBy: task.createdBy,
    status: 'open',
    createdAt: Date.now()
  }
  st.tasks.push(full)
  saveAll()
  sendState()
  return full
}

export function setTeamTaskStatus(taskId: string, status: TeamTaskStatus): TeamState {
  const st = ensureLoaded()
  const task = st.tasks.find((t) => t.id === taskId)
  if (task) {
    task.status = status
    saveAll()
    sendState()
  }
  return getTeamState()
}

export function removeTeamTask(taskId: string): TeamState {
  const st = ensureLoaded()
  st.tasks = st.tasks.filter((t) => t.id !== taskId)
  saveAll()
  sendState()
  return getTeamState()
}

/**
 * The team context for the AI: the local user's identity, level, duties,
 * scope and their open tasks. Goes into the system prompt of every run while
 * a team identity is chosen.
 */
export function teamAssistContext(): string | null {
  const st = ensureLoaded()
  const meFile = loadMe()
  if (!meFile.memberId) return null
  const member = st.members.find((m) => m.id === meFile.memberId)
  if (!member) return null
  const myTasks = st.tasks.filter((t) => t.assigneeId === member.id && t.status !== 'done')
  const taskLines = myTasks
    .map(
      (t) =>
        `- [${t.status === 'progress' ? 'в работе' : 'открыта'}] ${t.title}: ${t.description}`
    )
    .join('\n')
  const rules = [
    `You are the personal AI assistant of "${member.nick}" — ${member.level} ${member.specialty} on the team "${st.name}".`,
    'Help them within their role: their specialty defines what you implement and advise on.',
    member.scope.length > 0 && !member.scope.includes('**')
      ? `Their file scope — keep changes inside: ${member.scope.join(', ')}.`
      : '',
    member.duties ? `Their duties: ${member.duties}` : '',
    taskLines
      ? `Their open tasks on the board:\n${taskLines}\nWhen they ask for something vague, align with these tasks.`
      : 'They currently have no open tasks on the board.'
  ]
    .filter(Boolean)
    .join('\n')
  return `=== TEAM ===\n${rules}\n=== END TEAM ===`
}

/** Applies the local user's file scope to agent runs (null = unrestricted). */
export function applyMyScope(): void {
  const st = ensureLoaded()
  const meFile = loadMe()
  const member = st.members.find((m) => m.id === meFile.memberId)
  if (member && member.scope.length > 0 && !member.scope.includes('**')) {
    setAgentFileScope(member.scope, member.nick)
  } else {
    setAgentFileScope(null, '')
  }
}

/* --------------------------------------------------------------------- git */

function git(args: string[], cwd: string): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, timeout: 180_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        resolve({ ok: !error, output: `${stdout}\n${stderr}`.trim() })
      }
    )
  })
}

function headBranch(cwd: string): Promise<string> {
  return git(['symbolic-ref', '--short', 'HEAD'], cwd).then((r) =>
    r.ok ? r.output.trim() : ''
  )
}

async function ensureRepo(cwd: string): Promise<{ ok: boolean; base: string; error?: string }> {
  if (!existsSync(join(cwd, '.git'))) {
    const init = await git(['init'], cwd)
    if (!init.ok) return { ok: false, base: '', error: 'git init failed: ' + init.output }
    await git(['add', '-A'], cwd)
    await git(['commit', '-m', 'Team: initial commit'], cwd)
  }
  const branches = await git(['branch', '--list'], cwd)
  let base = ensureLoaded().baseBranch || 'main'
  if (/(^|\s)main(\s|$)/.test(branches.output)) base = 'main'
  else if (/(^|\s)master(\s|$)/.test(branches.output)) base = 'master'
  else {
    const head = await headBranch(cwd)
    if (head && !base) base = head
  }
  if (ensureLoaded().baseBranch !== base) {
    ensureLoaded().baseBranch = base
    saveAll()
  }
  return { ok: true, base }
}

function myBranch(member: TeamMember): string {
  return `team/${member.nick.toLowerCase().replace(/[^a-z0-9]/g, '-')}`
}

async function myToken(): Promise<string | null> {
  const meFile = loadMe()
  if (!meFile.tokenEnc) return null
  try {
    return safeStorage.decryptString(Buffer.from(meFile.tokenEnc, 'base64'))
  } catch {
    return null
  }
}

async function wireRemote(cwd: string, token: string): Promise<void> {
  const st = ensureLoaded()
  const remote = `https://x-access-token:${token}@github.com/${st.github.owner}/${st.github.repo}.git`
  await git(['remote', 'remove', 'origin'], cwd)
  await git(['remote', 'add', 'origin', remote], cwd)
}

/** Commits the working tree on the local user's branch and pushes it. */
export async function teamCommitAndPush(message: string): Promise<{
  ok: boolean
  error?: string
  branch?: string
}> {
  const workspaceRoot = getWorkspaceRoot()
  if (!workspaceRoot) return { ok: false, error: 'no-workspace' }
  const st = ensureLoaded()
  const meFile = loadMe()
  const member = st.members.find((m) => m.id === meFile.memberId)
  if (!member) return { ok: false, error: 'no-identity' }
  const repo = await ensureRepo(workspaceRoot)
  if (!repo.ok) return { ok: false, error: repo.error ?? 'git-failed' }

  const branch = myBranch(member)
  const current = await headBranch(workspaceRoot)
  if (current !== branch) {
    const exists = await git(['show-ref', '--verify', `refs/heads/${branch}`], workspaceRoot)
    const checkout = exists.ok
      ? await git(['checkout', branch], workspaceRoot)
      : await git(['checkout', '-b', branch], workspaceRoot)
    if (!checkout.ok) return { ok: false, error: 'checkout failed: ' + checkout.output }
  }

  const status = await git(['status', '--porcelain'], workspaceRoot)
  if (status.ok && status.output.trim() !== '') {
    await git(['add', '-A'], workspaceRoot)
    const commit = await git(
      ['commit', '-m', message.trim() || `${member.nick}: update`],
      workspaceRoot
    )
    if (!commit.ok) return { ok: false, error: 'commit failed: ' + commit.output.slice(-300) }
  }

  const token = await myToken()
  if (token && st.github.owner && st.github.repo) {
    await wireRemote(workspaceRoot, token)
    const push = await git(['push', '-u', 'origin', branch], workspaceRoot)
    if (!push.ok) return { ok: false, error: 'push failed: ' + push.output.slice(-300) }
    log(`Отправлено: ${branch} → GitHub`)
  }

  return { ok: true, branch }
}

/** Pulls the shared team file and the local user's branch from GitHub. */
export async function teamPull(): Promise<{ ok: boolean; error?: string }> {
  const workspaceRoot = getWorkspaceRoot()
  if (!workspaceRoot) return { ok: false, error: 'no-workspace' }
  const st = ensureLoaded()
  const meFile = loadMe()
  const member = st.members.find((m) => m.id === meFile.memberId)
  const token = await myToken()
  if (!token || !st.github.owner || !st.github.repo) return { ok: false, error: 'no-github' }
  await wireRemote(workspaceRoot, token)
  const fetch = await git(['fetch', 'origin'], workspaceRoot)
  if (!fetch.ok) return { ok: false, error: 'fetch failed: ' + fetch.output.slice(-300) }

  // The shared team file travels through the repo at .relaxcode/team.json.
  const show = await git(['show', `origin/${st.baseBranch}:.relaxcode/team.json`], workspaceRoot)
  if (show.ok && show.output.trim().startsWith('{')) {
    try {
      writeFileSync(TEAM_FILE(), show.output, 'utf8')
      state = null
    } catch {
      // Keep the previous file if writing fails.
    }
  }

  if (member) {
    const branch = myBranch(member)
    const checkout = await git(['checkout', branch], workspaceRoot)
    if (!checkout.ok) {
      await git(['checkout', '-b', branch, `origin/${branch}`], workspaceRoot)
    }
  }
  log('Обновлено с GitHub.')
  sendState()
  return { ok: true }
}

/** Commits the shared team file onto the base branch and pushes it. */
export async function teamPushRoster(): Promise<{ ok: boolean; error?: string }> {
  const workspaceRoot = getWorkspaceRoot()
  if (!workspaceRoot) return { ok: false, error: 'no-workspace' }
  const st = ensureLoaded()
  const base = st.baseBranch
  const current = await headBranch(workspaceRoot)
  if (current !== base) {
    const checkout = await git(['checkout', base], workspaceRoot)
    if (!checkout.ok) return { ok: false, error: 'checkout failed: ' + checkout.output }
  }
  const dir = join(workspaceRoot, '.relaxcode')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'team.json'), JSON.stringify(st, null, 2), 'utf8')
  await git(['add', '.relaxcode/team.json'], workspaceRoot)
  const commit = await git(['commit', '-m', 'team: update roster and tasks'], workspaceRoot)
  if (!commit.ok && !/nothing to commit/.test(commit.output)) {
    return { ok: false, error: 'commit failed: ' + commit.output.slice(-200) }
  }
  const token = await myToken()
  if (token && st.github.owner && st.github.repo) {
    await wireRemote(workspaceRoot, token)
    const push = await git(['push', 'origin', base], workspaceRoot)
    if (!push.ok) return { ok: false, error: 'push failed: ' + push.output.slice(-300) }
  }
  log('Состав команды и задачи отправлены на GitHub.')
  return { ok: true }
}

/**
 * Validates a token against the GitHub API: who it belongs to, whether it
 * reaches the team repo and whether it can push. Classic tokens report their
 * scopes in x-oauth-scopes; fine-grained ones leave it empty.
 */
export async function teamGithubCheck(
  owner: string,
  repoName: string,
  tokenPlain: string
): Promise<{
  ok: boolean
  login?: string
  scopes?: string
  repoAccess?: boolean
  canPush?: boolean
  error?: string
}> {
  const headers = {
    Authorization: `Bearer ${tokenPlain}`,
    Accept: 'application/vnd.github+json'
  }
  try {
    const user = await fetch('https://api.github.com/user', { headers })
    if (!user.ok) {
      return {
        ok: false,
        error:
          user.status === 401
            ? 'token-invalid'
            : `github http ${user.status}`
      }
    }
    const login = ((await user.json()) as { login?: string }).login ?? ''
    const scopes = user.headers.get('x-oauth-scopes') ?? ''
    const repoResponse = await fetch(`https://api.github.com/repos/${owner}/${repoName}`, { headers })
    const repoAccess = repoResponse.ok
    const classicWithRepo = scopes.split(',').some((s) => s.trim() === 'repo')
    return {
      ok: true,
      login,
      scopes: scopes || 'fine-grained (без классических скоупов)',
      repoAccess,
      canPush: repoAccess && (classicWithRepo || scopes === '')
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Creates the private GitHub repository for the team. */
export async function teamGithubCreate(
  owner: string,
  repoName: string,
  tokenPlain: string
): Promise<{ ok: boolean; error?: string; url?: string }> {
  const workspaceRoot = getWorkspaceRoot()
  if (!workspaceRoot) return { ok: false, error: 'no-workspace' }
  const repoCheck = await ensureRepo(workspaceRoot)
  if (!repoCheck.ok) return { ok: false, error: 'git-failed' }
  const st = ensureLoaded()

  if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'encryption-unavailable' }

  try {
    const response = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenPlain}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: repoName,
        description: st.description || st.name,
        private: true,
        auto_init: false
      })
    })
    const body = (await response.json().catch(() => ({}))) as {
      message?: string
      full_name?: string
      html_url?: string
    }
    const alreadyExists =
      !response.ok && /already exists/i.test(body.message ?? '')
    if (!response.ok && !alreadyExists) {
      return { ok: false, error: body.message ?? `http ${response.status}` }
    }

    st.github = {
      owner: (body.full_name ?? `${owner}/${repoName}`).split('/')[0],
      repo: (body.full_name ?? `${owner}/${repoName}`).split('/')[1],
      tokenEnc: null
    }
    setTeamMe(getTeamMe().memberId, tokenPlain)
    saveAll()
    log(`Репозиторий создан: ${st.github.owner}/${st.github.repo}`)
    sendState()
    return { ok: true, url: body.html_url }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/* ---------------------------------------------------------------- session */

export function setTeamNotify(forward: (event: TeamEvent) => void): void {
  emit = forward
  sendState()
}

export function beginTeamSession(): void {
  ensureLoaded()
  sendState()
}

export function endTeamSession(): void {
  emit = null
}
