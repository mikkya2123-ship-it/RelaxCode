import { useEffect, useState, type JSX } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Check,
  GitBranch,
  Lock,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  Users,
  X
} from 'lucide-react'
import type { TeamLevel, TeamMember, TeamSpecialty, TeamState, TeamTaskStatus } from '@shared/team'
import { TEAM_LEVELS, TEAM_SPECIALTIES } from '@shared/team'
import { useTeamStore } from '@/stores/team'
import { useT } from '@/lib/i18n'
import { useUiStore } from '@/stores/ui'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * The Friendly Development team screen: the shared roster and task board for
 * REAL teammates, the local identity picker ("who works here"), and the git
 * sync buttons. The AI agent that assists the local user reads the team
 * context — their role, scope and open tasks — from this data.
 */

const SPECIALTY_LABELS: Record<TeamSpecialty, string> = {
  admin: 'Тимлид',
  frontend: 'Фронтендер',
  backend: 'Бэкендер',
  fullstack: 'Фулстек',
  designer: 'Дизайнер',
  tester: 'Тестировщик',
  devops: 'Девопс',
  gameplay: 'Геймплей'
}

const LEVEL_LABELS: Record<TeamLevel, string> = {
  intern: 'Стажёр',
  junior: 'Джун',
  middle: 'Мидл',
  senior: 'Сеньор',
  lead: 'Лид'
}

const STATUS_LABELS: Record<TeamTaskStatus, string> = {
  open: 'открыта',
  progress: 'в работе',
  review: 'на ревью',
  done: 'готова'
}

const SPECIALTY_TINT: Record<TeamSpecialty, string> = {
  admin: '#f59e0b',
  frontend: '#3b82f6',
  backend: '#10b981',
  fullstack: '#8b5cf6',
  designer: '#ec4899',
  tester: '#14b8a6',
  devops: '#64748b',
  gameplay: '#ef4444'
}

function emptyMember(): TeamMember {
  return {
    id: `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    nick: '',
    specialty: 'frontend',
    level: 'junior',
    scope: [],
    duties: '',
    stats: { done: 0, failed: 0 }
  }
}

export function TeamScreen(): JSX.Element | null {
  const t = useT()
  const open = useTeamStore((s) => s.open)
  const closeTeam = useTeamStore((s) => s.closeTeam)
  const state = useTeamStore((s) => s.state)
  const log = useTeamStore((s) => s.log)
  const workspacePath = useUiStore((s) => s.workspace?.path ?? null)

  const [meId, setMeId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [members, setMembers] = useState<TeamMember[]>([])
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDesc, setTaskDesc] = useState('')
  const [taskAssignee, setTaskAssignee] = useState<string>('')
  const [commitMessage, setCommitMessage] = useState('')
  const [githubOwner, setGithubOwner] = useState('mikkya2123-ship-it')
  const [githubRepo, setGithubRepo] = useState('RelaxCode')
  const [githubToken, setGithubToken] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const locked = useTeamStore((st) => st.locked)
  const [expanded, setExpanded] = useState(false)

  // Seed the form from main-process state when the screen opens.
  useEffect(() => {
    if (!open || !state) return
    setName(state.name === 'Наша команда' ? '' : state.name)
    setDescription(state.description)
    setMembers(state.members)
    setGithubOwner(state.github.owner)
    setGithubRepo(state.github.repo)
    void window.relaxcode.team.meGet().then((info) => setMeId(info.memberId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Пока режим не готов: рабочий интерфейс скрыт, показываем только описание.
  if (locked) {
    if (!open) return null
    return (
      <div className="absolute inset-0 z-40 flex flex-col bg-background" data-testid="team-locked">
        <header className="flex h-12 shrink-0 items-center gap-3 px-4">
          <h1 className="text-[15px] font-semibold">{t('team.title')}</h1>
          <div className="ml-auto">
            <Button variant="primary" size="sm" onClick={closeTeam}>
              {t('arena.close')}
            </Button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[640px] px-6 py-10">
            <div className="flex items-center gap-3">
              <span className="relative inline-flex">
                <Users className="size-7 text-muted-foreground" />
                <Lock className="absolute -bottom-1 -right-1 size-4 rounded-full border border-background bg-card p-0.5 text-tertiary" />
              </span>
              <div>
                <h2 className="text-[16px] font-semibold">{t('team.soon.title')}</h2>
                <p className="text-[12px] text-muted-foreground">{t('team.soon.badge')}</p>
              </div>
            </div>
            <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
              {t('team.soon.teaser')}
            </p>
            {!expanded && (
              <Button
                variant="default"
                size="sm"
                className="mt-4 h-8 text-[12.5px]"
                onClick={() => setExpanded(true)}
              >
                {t('team.soon.more')}
              </Button>
            )}
            {expanded && (
              <div className="mt-4 space-y-3 text-[12.5px] leading-relaxed text-muted-foreground">
                <p className="font-medium text-foreground">{t('team.soon.howTitle')}</p>
                <ol className="list-decimal space-y-2 pl-5">
                  <li>{t('team.soon.how1')}</li>
                  <li>{t('team.soon.how2')}</li>
                  <li>{t('team.soon.how3')}</li>
                  <li>{t('team.soon.how4')}</li>
                  <li>{t('team.soon.how5')}</li>
                </ol>
                <p className="font-medium text-foreground">{t('team.soon.rolesTitle')}</p>
                <p>{t('team.soon.roles')}</p>
                <p className="font-medium text-foreground">{t('team.soon.githubTitle')}</p>
                <p>{t('team.soon.github')}</p>
                <p>{t('team.soon.network')}</p>
              </div>
            )}
            <p className="mt-6 text-[11px] text-tertiary">{t('team.soon.footer')}</p>
          </div>
        </div>
      </div>
    )
  }

  if (!open) return null

  const busyNow = busy !== null

  const saveTeam = async (next?: Partial<TeamState>): Promise<void> => {
    const base: TeamState = {
      name: name.trim() || 'Наша команда',
      description: description.trim(),
      members,
      tasks: state?.tasks ?? [],
      baseBranch: state?.baseBranch ?? 'main',
      github: state?.github ?? { owner: githubOwner.trim(), repo: githubRepo.trim(), tokenEnc: null }
    }
    useTeamStore.getState().applyEvent({ kind: 'state', state: { ...base, ...(next ?? {}) } })
    await window.relaxcode.team.save({ ...base, ...(next ?? {}) })
  }

  const setMember = (id: string, patch: Partial<TeamMember>): void => {
    const next = members.map((m) => (m.id === id ? { ...m, ...patch } : m))
    setMembers(next)
    void saveTeam({ members: next })
  }

  const addMember = (): void => {
    const member = emptyMember()
    const next = [...members, member]
    setMembers(next)
    void saveTeam({ members: next })
  }

  const removeMember = (id: string): void => {
    const next = members.filter((m) => m.id !== id)
    setMembers(next)
    void saveTeam({ members: next })
  }

  const moveLevel = (id: string, dir: 1 | -1): void => {
    const member = members.find((m) => m.id === id)
    if (!member) return
    const idx = TEAM_LEVELS.indexOf(member.level)
    setMember(id, { level: TEAM_LEVELS[Math.min(TEAM_LEVELS.length - 1, Math.max(0, idx + dir))] })
  }

  const pickMe = async (id: string | null): Promise<void> => {
    setMeId(id)
    const info = (await window.relaxcode.team.meSet(id)) as { memberId: string | null }
    setMeId(info.memberId)
  }

  const addTask = async (): Promise<void> => {
    if (taskTitle.trim().length === 0 || !meId) return
    await window.relaxcode.team.taskAdd({
      title: taskTitle.trim(),
      description: taskDesc.trim(),
      assigneeId: taskAssignee || meId,
      createdBy: meId
    })
    setTaskTitle('')
    setTaskDesc('')
  }

  const setStatus = async (taskId: string, status: TeamTaskStatus): Promise<void> => {
    await window.relaxcode.team.taskStatus(taskId, status)
  }

  const commitPush = async (): Promise<void> => {
    setBusy('git')
    setError(null)
    const result = await window.relaxcode.team.commitPush(commitMessage.trim())
    setBusy(null)
    if (!result.ok) setError(result.error ?? 'error')
    else setCommitMessage('')
  }

  const pull = async (): Promise<void> => {
    setBusy('pull')
    setError(null)
    const result = await window.relaxcode.team.pull()
    setBusy(null)
    if (!result.ok) setError(result.error ?? 'error')
  }

  const pushRoster = async (): Promise<void> => {
    setBusy('roster')
    setError(null)
    await saveTeam()
    const result = await window.relaxcode.team.rosterPush()
    setBusy(null)
    if (!result.ok) setError(result.error ?? 'error')
  }

  const [tokenCheck, setTokenCheck] = useState<string | null>(null)
  const [tokenOk, setTokenOk] = useState(false)

  const checkToken = async (): Promise<void> => {
    setBusy('check')
    setError(null)
    setTokenCheck(null)
    const result = await window.relaxcode.team.githubCheck(
      githubOwner.trim(),
      githubRepo.trim(),
      githubToken.trim()
    )
    setBusy(null)
    if (!result.ok) {
      setTokenCheck('Токен не принят GitHub: ' + (result.error ?? '?'))
      return
    }
    const canPush = result.canPush === true
    setTokenOk(canPush && result.repoAccess === true)
    // Токен сразу сохраняется локально: коммит-пуш сработает без повторного ввода.
    if (meId) await window.relaxcode.team.meSet(meId, githubToken.trim())
    setTokenCheck(
      (canPush
        ? '✓ Токен рабочий: аккаунт ' + (result.login ?? '?') + ', доступ к репозиторию есть, пуш возможен.'
        : '⚠ Токен принят (аккаунт ' + (result.login ?? '?') + '), но пушить он не может: ' +
          (result.repoAccess === false
            ? 'нет доступа к этому репозиторию.'
            : 'это fine-grained токен без права repo. Создай классический токен с галочкой repo, или выдай этому токену право Contents: Read and write.')) +
      ' Токен сохранён — жми «Закоммитить и отправить».'
    )
  }

  const createGithub = async (): Promise<void> => {
    setBusy('github')
    setError(null)
    await saveTeam()
    const result = await window.relaxcode.team.githubCreate(
      githubOwner.trim(),
      githubRepo.trim(),
      githubToken.trim()
    )
    setBusy(null)
    if (!result.ok) setError(result.error ?? 'error')
    setGithubToken('')
  }

  const myTasks = state?.tasks.filter((task) => task.assigneeId === meId) ?? []
  const otherTasks = state?.tasks.filter((task) => task.assigneeId !== meId) ?? []

  const taskRow = (
    task: TeamState['tasks'][number],
    mine: boolean
  ): JSX.Element => (
    <div
      key={task.id}
      className="rounded-lg border border-input/60 bg-background/50 p-2.5"
      style={{
        borderLeft: `4px solid ${SPECIALTY_TINT[members.find((m) => m.id === task.assigneeId)?.specialty ?? 'fullstack']}`
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] font-medium">{task.title}</span>
        <span className="rounded bg-accent px-1.5 py-0.5 text-[10.5px] text-muted-foreground">
          {members.find((m) => m.id === task.assigneeId)?.nick ?? '—'}
        </span>
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-[10.5px]',
            task.status === 'done' && 'bg-emerald-500/15 text-emerald-500',
            task.status === 'progress' && 'bg-amber-500/15 text-amber-500',
            task.status === 'review' && 'bg-blue-500/15 text-blue-400',
            task.status === 'open' && 'bg-accent text-muted-foreground'
          )}
        >
          {STATUS_LABELS[task.status]}
        </span>
        {mine && task.status !== 'done' && (
          <div className="ml-auto flex items-center gap-1">
            {task.status !== 'progress' && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px]"
                onClick={() => void setStatus(task.id, 'progress')}
              >
                {t('team.taskStart')}
              </Button>
            )}
            {task.status === 'progress' && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px]"
                onClick={() => void setStatus(task.id, 'review')}
              >
                {t('team.taskReview')}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-[11px] text-emerald-500"
              onClick={() => void setStatus(task.id, 'done')}
            >
              <Check className="size-3" />
              {t('team.taskDone')}
            </Button>
          </div>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('action.removeItem')}
          className={cn(!mine && 'ml-auto')}
          onClick={() => void window.relaxcode.team.taskRemove(task.id)}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      {task.description && (
        <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">{task.description}</p>
      )}
    </div>
  )

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-background" data-testid="team-screen">
      <header className="flex h-12 shrink-0 items-center gap-3 px-4">
        <Users className="size-4 text-foreground/80" />
        <h1 className="text-[15px] font-semibold">{t('team.title')}</h1>
        <p className="hidden text-[12px] text-muted-foreground sm:block">{t('team.subtitle')}</p>
        <div className="ml-auto flex items-center gap-2">
          {!workspacePath && (
            <Button
              variant="default"
              size="sm"
              className="h-8 gap-1.5 text-[12.5px]"
              onClick={() => void window.relaxcode.workspace.openFolder()}
            >
              {t('team.openFolder')}
            </Button>
          )}
          <Button variant="primary" size="sm" onClick={closeTeam}>
            {t('arena.close')}
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[980px] px-6 py-5">
          {/* Who works on this machine */}
          <section className="mb-5 rounded-xl border border-ring/40 bg-accent/30 p-4">
            <h3 className="text-[13px] font-semibold">{t('team.who.title')}</h3>
            <p className="mt-1 text-[11.5px] text-muted-foreground">{t('team.who.hint')}</p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {members.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => void pickMe(member.id === meId ? null : member.id)}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[12.5px] transition-colors',
                    member.id === meId
                      ? 'border-ring bg-card text-foreground shadow-xs'
                      : 'border-input text-muted-foreground hover:text-foreground'
                  )}
                >
                  <span
                    className="flex size-5 items-center justify-center rounded-full text-[10px] font-bold text-white"
                    style={{ backgroundColor: SPECIALTY_TINT[member.specialty] }}
                  >
                    {member.nick.slice(0, 1).toUpperCase() || '?'}
                  </span>
                  {member.nick || '—'}
                  <span className="text-[10px] text-tertiary">{LEVEL_LABELS[member.level]}</span>
                </button>
              ))}
              {members.length === 0 && (
                <span className="text-[12px] text-tertiary">{t('team.who.empty')}</span>
              )}
            </div>
          </section>

          <p className="mb-4 text-[12px] text-muted-foreground">
            {workspacePath
              ? t('team.workspaceOpen', { path: workspacePath })
              : t('team.workspaceNone')}
          </p>

          {/* Team identity */}
          <section className="mb-5 rounded-xl border border-border bg-card p-4">
            <div className="grid gap-2.5 sm:grid-cols-2">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                onBlur={() => void saveTeam()}
                placeholder={t('team.namePlaceholder')}
                className="h-9 text-[13px]"
              />
              <Input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                onBlur={() => void saveTeam()}
                placeholder={t('team.descPlaceholder')}
                className="h-9 text-[13px]"
              />
            </div>
          </section>

          {/* Roster */}
          <section className="mb-5 space-y-2.5">
            {members.map((member) => (
              <div
                key={member.id}
                className="rounded-lg border border-input/60 bg-background/50 p-2.5"
                style={{ borderLeft: `4px solid ${SPECIALTY_TINT[member.specialty]}` }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={member.nick}
                    onChange={(event) => setMember(member.id, { nick: event.target.value })}
                    placeholder={t('team.nickPlaceholder')}
                    className="h-8 w-[130px] rounded-md border border-input bg-background px-2 text-[12px] font-semibold"
                  />
                  <select
                    value={member.specialty}
                    onChange={(event) =>
                      setMember(member.id, { specialty: event.target.value as TeamSpecialty })
                    }
                    className="h-8 rounded-md border border-input bg-background px-2 text-[12px]"
                  >
                    {TEAM_SPECIALTIES.map((spec) => (
                      <option key={spec} value={spec}>
                        {SPECIALTY_LABELS[spec]}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('team.levelDown')}
                      onClick={() => moveLevel(member.id, -1)}
                    >
                      <ArrowDown className="size-3.5" />
                    </Button>
                    <span className="w-[74px] text-center text-[12px] font-medium">
                      {LEVEL_LABELS[member.level]}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('team.levelUp')}
                      onClick={() => moveLevel(member.id, 1)}
                    >
                      <ArrowUp className="size-3.5" />
                    </Button>
                  </div>
                  <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                    ✓{member.stats.done}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('action.removeItem')}
                    onClick={() => removeMember(member.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    value={member.scope.join(', ')}
                    onChange={(event) =>
                      setMember(member.id, {
                        scope: event.target.value
                          .split(',')
                          .map((item) => item.trim())
                          .filter(Boolean)
                      })
                    }
                    onBlur={() => void saveTeam()}
                    placeholder={t('team.scopePlaceholder')}
                    className="h-7 min-w-[220px] flex-1 rounded-md border border-input bg-background px-2 text-[11.5px] font-mono"
                  />
                  <input
                    value={member.duties}
                    onChange={(event) => setMember(member.id, { duties: event.target.value })}
                    onBlur={() => void saveTeam()}
                    placeholder={t('team.dutiesPlaceholder')}
                    className="h-7 min-w-[220px] flex-1 rounded-md border border-input bg-background px-2 text-[11.5px]"
                  />
                </div>
              </div>
            ))}
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-[13px]" onClick={addMember}>
              <Plus className="size-3.5" />
              {t('team.addMember')}
            </Button>
            <p className="whitespace-pre-line rounded-lg bg-accent/40 px-3 py-2 text-[11.5px] leading-relaxed text-muted-foreground">
              {t('team.inviteHint')}
            </p>
          </section>

          {/* Task board */}
          <section className="mb-5 rounded-xl border border-border bg-card p-4">
            <h3 className="text-[13px] font-semibold">{t('team.board')}</h3>
            <div className="mt-2.5 grid gap-2 sm:grid-cols-[1fr_auto]">
              <Input
                value={taskTitle}
                onChange={(event) => setTaskTitle(event.target.value)}
                placeholder={t('team.taskTitlePlaceholder')}
                className="h-9 text-[13px]"
              />
              <select
                value={taskAssignee || meId || ''}
                onChange={(event) => setTaskAssignee(event.target.value)}
                className="h-9 rounded-md border border-input bg-background px-2 text-[12.5px]"
              >
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.nick || '—'}
                  </option>
                ))}
              </select>
            </div>
            <textarea
              value={taskDesc}
              onChange={(event) => setTaskDesc(event.target.value)}
              rows={2}
              placeholder={t('team.taskDescPlaceholder')}
              className="mt-2 w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-[12.5px] focus:border-ring focus:outline-none"
            />
            <div className="mt-2 flex justify-end">
              <Button
                variant="default"
                size="sm"
                className="h-8 gap-1.5 text-[12.5px]"
                disabled={taskTitle.trim().length === 0 || !meId}
                onClick={() => void addTask()}
              >
                <Plus className="size-3.5" />
                {t('team.taskAdd')}
              </Button>
            </div>

            {myTasks.length > 0 && (
              <>
                <p className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('team.myTasks')}
                </p>
                <div className="space-y-2">{myTasks.map((task) => taskRow(task, true))}</div>
              </>
            )}
            {otherTasks.length > 0 && (
              <>
                <p className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('team.otherTasks')}
                </p>
                <div className="space-y-2">{otherTasks.map((task) => taskRow(task, false))}</div>
              </>
            )}
            {(state?.tasks.length ?? 0) === 0 && (
              <p className="mt-2 text-[12px] text-tertiary">{t('team.noTasks')}</p>
            )}
          </section>

          {/* Git sync */}
          <section className="mb-5 rounded-xl border border-border bg-card p-4">
            <h3 className="flex items-center gap-2 text-[13px] font-semibold">
              <GitBranch className="size-4" />
              {t('team.git.title')}
            </h3>
            <p className="mt-1 text-[11.5px] text-muted-foreground">{t('team.git.hint')}</p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <Input
                value={commitMessage}
                onChange={(event) => setCommitMessage(event.target.value)}
                placeholder={t('team.git.messagePlaceholder')}
                className="h-8 min-w-[220px] flex-1 text-[12.5px]"
              />
              <Button
                variant="primary"
                size="sm"
                className="h-8 gap-1.5 text-[12.5px]"
                disabled={busyNow || !meId}
                onClick={() => void commitPush()}
              >
                {busy === 'git' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Upload className="size-3.5" />
                )}
                {t('team.git.commitPush')}
              </Button>
              <Button
                variant="muted"
                size="sm"
                className="h-8 gap-1.5 text-[12.5px]"
                disabled={busyNow}
                onClick={() => void pull()}
              >
                {busy === 'pull' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                {t('team.git.pull')}
              </Button>
              <Button
                variant="muted"
                size="sm"
                className="h-8 gap-1.5 text-[12.5px]"
                disabled={busyNow}
                onClick={() => void pushRoster()}
              >
                {busy === 'roster' ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {t('team.git.pushRoster')}
              </Button>
            </div>
          </section>

          {/* GitHub */}
          <section className="mb-5 rounded-xl border border-border bg-card p-4">
            <h3 className="text-[13px] font-semibold">{t('team.github.title')}</h3>
            <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
              {t('team.github.hint')}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-tertiary">
              {t('team.github.hintClassic')}
            </p>
            <div className="mt-2.5 grid gap-2 sm:grid-cols-3">
              <Input
                value={githubOwner}
                onChange={(event) => setGithubOwner(event.target.value)}
                placeholder={t('team.github.owner')}
                className="h-8 text-[12.5px]"
              />
              <Input
                value={githubRepo}
                onChange={(event) => setGithubRepo(event.target.value)}
                placeholder={t('team.github.repo')}
                className="h-8 text-[12.5px]"
              />
              <Input
                type="password"
                value={githubToken}
                onChange={(event) => setGithubToken(event.target.value)}
                placeholder={t('team.github.token')}
                className="h-8 text-[12.5px]"
              />
            </div>
            <div className="mt-2.5 flex items-center justify-end gap-2">
              <Button
                variant="default"
                size="sm"
                className="h-8 text-[12.5px]"
                disabled={
                  busyNow ||
                  githubOwner.trim().length === 0 ||
                  githubToken.trim().length === 0
                }
                onClick={() => void checkToken()}
              >
                {busy === 'check' ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {t('team.github.check')}
              </Button>
              <Button
                variant="default"
                size="sm"
                className="h-8 text-[12.5px]"
                disabled={busyNow || tokenOk}
                onClick={() => void createGithub()}
              >
                {busy === 'github' ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {t('team.github.create')}
              </Button>
            </div>
            {tokenCheck && (
              <p
                className={cn(
                  'mt-2 rounded-lg px-3 py-2 text-[11.5px] leading-relaxed',
                  tokenOk
                    ? 'bg-emerald-500/10 text-emerald-500'
                    : 'bg-amber-500/10 text-amber-500'
                )}
              >
                {tokenCheck}
              </p>
            )}
          </section>

          {error && (
            <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2">
              <p className="text-[12.5px] leading-relaxed text-destructive">
                {error.includes('not accessible')
                  ? t('team.error.github-scope')
                  : t(`team.error.${error}` as never) === `team.error.${error}`
                    ? error
                    : t(`team.error.${error}` as never)}
              </p>
              {error === 'no-workspace' && (
                <Button
                  variant="default"
                  size="sm"
                  className="mt-2 h-7 text-[12px]"
                  onClick={() => void window.relaxcode.workspace.openFolder()}
                >
                  {t('team.openFolder')}
                </Button>
              )}
            </div>
          )}

          {log.length > 0 && (
            <pre className="max-h-[160px] overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/60 p-2.5 font-mono text-[10.5px] leading-relaxed text-muted-foreground">
              {log.join('\n')}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}
