import { readFileSync, writeFileSync } from 'node:fs'
import { app } from 'electron'
import { join } from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import type { TodoItem } from '@shared/ipc'
import { pushAgentPrompt } from './ui-bridge'
import { argNumber, argString, relPath, resolveInWorkspace, ToolError, type ToolDef } from './tool-utils'

/**
 * Time and watching: delayed prompts (a cheaper cron), folder watchers that
 * wake the agent when files change, and a persistent day-plan that survives
 * across chats (unlike todo_write, which lives inside one run).
 */

// --- delayed prompts -----------------------------------------------------------

interface ScheduledPrompt {
  id: string
  prompt: string
  fireAt: number
}

const schedulesPath = (): string => join(app.getPath('userData'), 'schedules.json')

function readSchedules(): ScheduledPrompt[] {
  try {
    const parsed = JSON.parse(readFileSync(schedulesPath(), 'utf8')) as ScheduledPrompt[]
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.prompt === 'string') : []
  } catch {
    return []
  }
}

function writeSchedules(items: ScheduledPrompt[]): void {
  writeFileSync(schedulesPath(), JSON.stringify(items))
}

let tickerStarted = false

function ensureTicker(): void {
  if (tickerStarted) return
  tickerStarted = true
  // Past-due prompts from a previous session fire once, shortly after launch.
  setInterval(
    () => {
      const now = Date.now()
      const due = readSchedules().filter((item) => item.fireAt <= now)
      if (due.length === 0) return
      writeSchedules(readSchedules().filter((item) => item.fireAt > now))
      for (const item of due) pushAgentPrompt(item.prompt)
    },
    30_000
  ).unref?.()
}

const scheduleTaskTool: ToolDef = {
  name: 'schedule_task',
  description:
    'Schedule a future task for yourself: at the chosen time the prompt is sent into the chat as if the user wrote it. Use in_minutes for "in 15 minutes" style delays, or at "HH:MM" (24h, today or tomorrow) for an exact time. Only forward-looking tasks make sense.',
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'What to do when it fires, e.g. "Re-run the tests and report"' },
      in_minutes: { type: 'number', description: 'Delay in minutes (max 7 days)' },
      at: { type: 'string', description: 'Exact time HH:MM (24-hour, local)' },
      list: { type: 'boolean', description: 'Just list pending tasks' }
    },
    required: ['prompt']
  },
  risk: 'write',
  execute: async (args) => {
    ensureTicker()
    if (argString(args, 'prompt', false) === 'list' || args.list === true) {
      const pending = readSchedules()
      return {
        ok: true,
        summary: `${pending.length} pending task(s)`,
        detail:
          pending.length === 0
            ? 'Nothing scheduled.'
            : pending.map((item) => `${new Date(item.fireAt).toLocaleString()} — ${item.prompt}`).join('\n')
      }
    }
    const prompt = argString(args, 'prompt').slice(0, 1000)
    const inMinutes = argNumber(args, 'in_minutes')
    const at = argString(args, 'at', false)
    let fireAt = 0
    if (typeof inMinutes === 'number' && inMinutes > 0) {
      fireAt = Date.now() + Math.min(inMinutes, 7 * 24 * 60) * 60_000
    } else if (/^\d{1,2}:\d{2}$/.test(at)) {
      const [hours, minutes] = at.split(':').map(Number)
      const when = new Date()
      when.setHours(hours, minutes, 0, 0)
      if (when.getTime() <= Date.now()) when.setDate(when.getDate() + 1)
      fireAt = when.getTime()
    } else {
      throw new ToolError('Pass in_minutes (number) or at ("HH:MM")')
    }
    const item: ScheduledPrompt = { id: `${fireAt}-${Math.random().toString(36).slice(2, 7)}`, prompt, fireAt }
    writeSchedules([...readSchedules().filter((existing) => existing.fireAt > Date.now()), item])
    return {
      ok: true,
      summary: `scheduled for ${new Date(fireAt).toLocaleString()}`,
      detail: `When the time comes, this prompt arrives in the chat: "${prompt}"`
    }
  }
}

// --- folder watchers --------------------------------------------------------------

const WATCHER_LIMIT = 5
const watchers = new Map<string, FSWatcher>()

const watchFolderTool: ToolDef = {
  name: 'watch_folder',
  description:
    'Watch a workspace folder and wake yourself when files change in it: each change sends the given prompt into the chat (with {file} replaced by the path). Use it to react to dropped files, generated exports or logs. action: watch (default) | list | stop.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['watch', 'list', 'stop'], description: 'What to do (default watch)' },
      path: { type: 'string', description: 'Workspace folder to watch (watch)' },
      prompt: { type: 'string', description: 'Prompt to send when a file changes; {file} = the path (watch)' },
      id: { type: 'string', description: 'Watcher id (stop)' }
    }
  },
  risk: 'write',
  execute: async (args, ctx) => {
    const action = argString(args, 'action', false) || 'watch'

    if (action === 'list') {
      return {
        ok: true,
        summary: `${watchers.size} watcher(s)`,
        detail: watchers.size === 0 ? 'No folders are being watched.' : [...watchers.keys()].join('\n')
      }
    }
    if (action === 'stop') {
      const id = argString(args, 'id', false)
      const key = id && watchers.has(id) ? id : [...watchers.keys()].pop()
      if (!key) return { ok: false, summary: 'nothing to stop', detail: 'No watchers are active.' }
      await watchers.get(key)?.close()
      watchers.delete(key)
      return { ok: true, summary: `stopped ${key}`, detail: 'The folder is no longer watched.' }
    }

    const folder = resolveInWorkspace(argString(args, 'path', false) || '.')
    const prompt = argString(args, 'prompt').slice(0, 1000)
    if (watchers.size >= WATCHER_LIMIT) {
      return { ok: false, summary: `watcher limit (${WATCHER_LIMIT}) reached`, detail: 'Stop one first with action "stop".' }
    }
    const id = relPath(folder)
    await watchers.get(id)?.close()
    let timer: ReturnType<typeof setTimeout> | null = null
    let lastFile = ''
    const flush = (): void => {
      timer = null
      pushAgentPrompt(prompt.replaceAll('{file}', lastFile))
    }
    watchers.set(
      id,
      watch(folder, {
        ignoreInitial: true,
        depth: 4,
        ignored: /(^|[\\/])node_modules($|[\\/])|(^|[\\/])\.git($|[\\/])/
      }).on('all', (_event, file) => {
        lastFile = String(file)
        // Editors touch a file many times in a second; one wake per pause.
        if (timer) clearTimeout(timer)
        timer = setTimeout(flush, 1500)
      })
    )
    void ctx.signal
    return {
      ok: true,
      summary: `watching ${id}`,
      detail: `Every change (after a 1.5s pause) sends: "${prompt}" ({file} becomes the changed path). Stop with action "stop", id "${id}".`
    }
  }
}

// --- persistent task queue ---------------------------------------------------------

interface StoredTask {
  id: string
  text: string
  done: boolean
  at: number
}

const queuePath = (): string => join(app.getPath('userData'), 'task-queue.json')

function readQueue(): StoredTask[] {
  try {
    const parsed = JSON.parse(readFileSync(queuePath(), 'utf8')) as StoredTask[]
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.text === 'string').slice(0, 100) : []
  } catch {
    return []
  }
}

function writeQueue(items: StoredTask[]): void {
  writeFileSync(queuePath(), JSON.stringify(items))
}

const taskQueueTool: ToolDef = {
  name: 'task_queue',
  description:
    'The persistent plan for this workspace — survives across chats (unlike todo_write, which is for one run) and shows in the todo panel. action: add (text) | list | done (id) | clear. Use it for day-sized plans the user asked you to work through.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['add', 'list', 'done', 'clear'], description: 'What to do' },
      text: { type: 'string', description: 'add: the task' },
      id: { type: 'string', description: 'done: task id from list' }
    },
    required: ['action']
  },
  risk: 'write',
  execute: async (args, ctx) => {
    const action = argString(args, 'action')
    const items = readQueue()

    if (action === 'add') {
      const text = argString(args, 'text').slice(0, 300)
      const task: StoredTask = { id: `q${Date.now().toString(36)}`, text, done: false, at: Date.now() }
      writeQueue([...items, task])
      pushQueueToPanel(ctx, [...items, task])
      return { ok: true, summary: `added: ${text}`, detail: `Task ${task.id} is in the plan.` }
    }
    if (action === 'done') {
      const id = argString(args, 'id', false)
      const updated = items.map((item) => (item.id === id ? { ...item, done: true } : item))
      writeQueue(updated)
      pushQueueToPanel(ctx, updated)
      const left = updated.filter((item) => !item.done).length
      return { ok: true, summary: `done: ${id}`, detail: left === 0 ? 'The whole plan is complete.' : `${left} task(s) left.` }
    }
    if (action === 'clear') {
      writeQueue([])
      pushQueueToPanel(ctx, [])
      return { ok: true, summary: 'plan cleared', detail: 'All queued tasks were removed.' }
    }
    if (action === 'list') {
      return {
        ok: true,
        summary: `${items.length} task(s), ${items.filter((item) => item.done).length} done`,
        detail: items.length === 0 ? 'The plan is empty.' : items.map((item) => `${item.done ? '✔' : '·'} ${item.id} ${item.text}`).join('\n')
      }
    }
    throw new ToolError(`Unknown action: ${action}`)
  }
}

function pushQueueToPanel(ctx: { setTodos: (todos: TodoItem[]) => void }, items: StoredTask[]): void {
  ctx.setTodos(
    items.slice(-12).map((item) => ({
      id: item.id,
      content: item.text,
      status: item.done ? 'completed' : 'pending'
    }))
  )
}

export const SCHEDULE_TOOLS: ToolDef[] = [scheduleTaskTool, watchFolderTool, taskQueueTool]
