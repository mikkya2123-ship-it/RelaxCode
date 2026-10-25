import { create } from 'zustand'
import type {
  ApprovalDecision,
  ApprovalRequest,
  BackgroundProcessInfo,
  ChatEvent,
  ChatMessagePayload,
  ChatMode,
  TodoItem
} from '@shared/ipc'
import { useSettingsStore } from '@/stores/settings'
import { useEditorStore } from '@/stores/editor'
import { attachmentNote, type AttachmentRef } from '@shared/attachments'
import { THINKING_LEVELS, type ThinkingLevel } from '@shared/reasoning'
import type { ToolMeta } from '@shared/tool-meta'

export interface TextPart {
  kind: 'text'
  text: string
}

export interface ToolPart {
  kind: 'tool'
  callId: string
  name: string
  args: string
  status: 'running' | 'ok' | 'error'
  summary: string
  detail: string
  /** Structured progress for rich cards (web search sources, pages, stages). */
  meta?: ToolMeta
}

/** The model's own thinking before it answered — shown as a collapsible block. */
export interface ReasoningPart {
  kind: 'reasoning'
  text: string
  /** When the block started, so the UI can show how long the model thought. */
  startedAt: number
  /** Last piece received; the block counts as live while the message streams. */
  endedAt: number
}

/** A file the user pinned to their message; the model sees it as content parts. */
export interface AttachmentPart {
  kind: 'attachment'
  attachment: AttachmentRef
}

export type ChatPart = TextPart | ToolPart | ReasoningPart | AttachmentPart

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  parts: ChatPart[]
  status: 'streaming' | 'done' | 'error'
  error?: string
  /** Set on a user message that interrupted a running agent (steering). */
  steered?: boolean
  /** Snapshot of the project taken right before this message's run changed files. */
  snapshot?: string
  /** When the message was sent (ms since epoch); shown when timestamps are on. */
  at?: number
  promptTokens?: number
  completionTokens?: number
  /** Completion tokens the provider counted as reasoning. */
  reasoningTokens?: number
  /** Conversation size (prompt + answer) as the provider counted it on the last step. */
  contextTokens?: number
}

export interface PendingQuestion {
  questionId: string
  question: string
  options: string[]
}

export type ChatNotice = Extract<ChatEvent, { type: 'notice' }>

/** A message waiting in the queue while the agent works. */
export interface QueueItem {
  id: string
  text: string
  at: number
}

/** One conversation: its own messages, its own run and its own mode. */
export interface ChatSession {
  id: string
  title: string
  createdAt: number
  mode: ChatMode
  /** How deeply this chat asks the model to think. */
  thinking: ThinkingLevel
  messages: ChatMessage[]
  streaming: boolean
  requestId: string | null
  todos: TodoItem[]
  pendingApproval: ApprovalRequest | null
  pendingQuestion: PendingQuestion | null
  notice: ChatNotice | null
  /** Messages that will be sent once the current run finishes. */
  queue: QueueItem[]
  /** The run sits between steps, waiting to be resumed. */
  paused: boolean
  /** Night autopilot: full-auto within the limits from the agent settings. */
  night: boolean
  /**
   * Tokens the provider counted for the whole conversation on the last answered
   * request. The context meter compares it with the model's window.
   */
  contextTokens?: number
  /** What the last request left out thanks to token saving (null when off). */
  saved?: { messages: number; chars: number }
}

/**
 * The active chat is projected onto the top level of the store so components
 * (and the dev-build test hooks) can read it without digging through `chats`.
 */
type ChatView = Pick<
  ChatSession,
  | 'messages'
  | 'streaming'
  | 'requestId'
  | 'mode'
  | 'thinking'
  | 'todos'
  | 'pendingApproval'
  | 'pendingQuestion'
  | 'notice'
  | 'contextTokens'
  | 'saved'
  | 'queue'
  | 'paused'
  | 'night'
>

interface ChatState extends ChatView {
  /** Every chat of this session, newest first. */
  chats: ChatSession[]
  activeChatId: string
  /** Servers live in the main process and are shared by all chats. */
  processes: BackgroundProcessInfo[]
  newChat: () => string
  selectChat: (id: string) => void
  deleteChat: (id: string) => void
  /** Throws every chat away and starts from a single empty one. */
  clearAll: () => void
  setMode: (mode: ChatMode) => void
  setThinking: (level: ThinkingLevel) => void
  send: (text: string, chatId?: string, attachments?: AttachmentRef[]) => Promise<boolean>
  stop: () => void
  /** Puts a message in the queue: it runs after the current task finishes. */
  enqueue: (text: string) => void
  /** Reorders, edits or drops one queued message. */
  queueAction: (id: string, action: 'up' | 'down' | 'remove' | 'edit', text?: string) => void
  /** Interrupts the running agent; false when nothing runs (send instead). */
  steer: (text: string) => Promise<boolean>
  togglePause: () => void
  toggleNight: () => void
  stopProcess: (id: string) => void
  loadProcesses: () => Promise<void>
  respondApproval: (decision: ApprovalDecision, editedArgs?: string) => void
  replyQuestion: (text: string) => void
  handleEvent: (event: ChatEvent) => void
  reset: () => void
}

const HISTORY_LIMIT = 40
const MODE_KEY = 'relaxcode.chatMode'
const THINKING_KEY = 'relaxcode.chatThinking'
const STORAGE_KEY = 'relaxcode.chats.v1'
/** Keys used before the EasyCode → RelaxCode rename; read as a one-time fallback. */
const LEGACY_MODE_KEY = 'easycode.chatMode'
const LEGACY_STORAGE_KEY = 'easycode.chats.v1'

/** Reads a key, falling back to its pre-rename name. */
function readStored(key: string, legacyKey: string): string | null {
  if (typeof localStorage === 'undefined') return null
  return localStorage.getItem(key) ?? localStorage.getItem(legacyKey)
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage may be unavailable; the chat keeps its level in memory.
  }
}

const TITLE_LIMIT = 48
const TOOL_DETAIL_LIMIT = 4000
/** Reasoning is kept in the transcript, but only the beginning of it. */
const REASONING_STORE_LIMIT = 4000
/** Hard cap while streaming, so a runaway model cannot fill memory. */
const REASONING_LIMIT = 20000
/**
 * localStorage is a few megabytes in total. Embedded pictures are large, so a
 * transcript that outgrows this budget is saved without them (the cards remain
 * in the live chat) instead of failing to save at all.
 */
const STORAGE_BUDGET = 3_500_000

/** The mode of a fresh chat: the settings default, falling back to the last one used. */
function readMode(): ChatMode {
  const preferred = useSettingsStore.getState().settings?.chat.defaultMode
  if (preferred) return preferred
  const stored = readStored(MODE_KEY, LEGACY_MODE_KEY)
  if (stored === 'ask') return 'chat'
  if (stored === 'chat' || stored === 'agent' || stored === 'plan') return stored
  return 'agent'
}

/** The reasoning level of a fresh chat: settings default, then the last one used. */
function readThinking(): ThinkingLevel {
  const preferred = useSettingsStore.getState().settings?.chat.defaultThinking
  if (preferred && THINKING_LEVELS.includes(preferred)) return preferred
  const stored = readStored(THINKING_KEY, THINKING_KEY)
  if (stored && (THINKING_LEVELS as readonly string[]).includes(stored)) return stored as ThinkingLevel
  return 'off'
}

function newSession(mode: ChatMode): ChatSession {
  return {
    id: crypto.randomUUID(),
    title: '',
    createdAt: Date.now(),
    mode,
    thinking: readThinking(),
    messages: [],
    streaming: false,
    requestId: null,
    todos: [],
    pendingApproval: null,
    pendingQuestion: null,
    notice: null,
    queue: [],
    paused: false,
    night: false
  }
}

function view(chat: ChatSession): ChatView {
  return {
    messages: chat.messages,
    streaming: chat.streaming,
    requestId: chat.requestId,
    mode: chat.mode,
    thinking: chat.thinking,
    todos: chat.todos,
    pendingApproval: chat.pendingApproval,
    pendingQuestion: chat.pendingQuestion,
    notice: chat.notice,
    contextTokens: chat.contextTokens,
    saved: chat.saved,
    queue: chat.queue,
    paused: chat.paused,
    night: chat.night
  }
}

/** The chat list shows the first user message instead of "New chat". */
function deriveTitle(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > TITLE_LIMIT ? `${oneLine.slice(0, TITLE_LIMIT - 1)}…` : oneLine
}

export function messageText(message: ChatMessage): string {
  const text = message.parts
    .filter((part): part is TextPart => part.kind === 'text')
    .map((part) => part.text)
    .join('')
  // The bytes of an attachment travel with their own message only; every
  // later turn sees this note instead, so the model at least remembers that
  // a photo was sent and what it was called.
  const notes = message.parts
    .filter((part): part is AttachmentPart => part.kind === 'attachment')
    .map((part) => attachmentNote(part.attachment))
    .join('\n')
  const withNotes = notes === '' ? text : text === '' ? notes : `${text}\n${notes}`
  // An assistant turn that only ran tools often has no prose at all. Sending it
  // as an empty message drops it from the history, so the model forgets what it
  // drew or changed; a one-line tool digest keeps that memory.
  if (withNotes.trim() !== '' || message.role !== 'assistant') return withNotes
  return message.parts
    .filter((part): part is ToolPart => part.kind === 'tool' && part.status !== 'running')
    .map((part) => {
      const figure = part.meta?.kind === 'figure' ? part.meta : null
      // The measured values matter more than the element count: they are what
      // the user corrects in the next message.
      const figureDigest = figure
        ? [
            figure.title,
            (figure.results ?? []).map((item) => `${item.label} = ${item.value}`).join(', ')
          ]
            .filter((entry) => !!entry)
            .join(' · ')
        : ''
      const outcome = part.status === 'error' ? 'failed' : part.summary || 'done'
      return `[${part.name}: ${outcome}${figureDigest ? ` (${figureDigest})` : ''}]`
    })
    .join('\n')
}

function appendText(message: ChatMessage, text: string): ChatMessage {
  const last = message.parts[message.parts.length - 1]
  if (last && last.kind === 'text') {
    const parts = message.parts.slice(0, -1)
    parts.push({ kind: 'text', text: last.text + text })
    return { ...message, parts }
  }
  return { ...message, parts: [...message.parts, { kind: 'text', text }] }
}

/** Reasoning of one step lands in one block, so thoughts and tool cards interleave. */
function appendReasoning(message: ChatMessage, text: string, at: number): ChatMessage {
  const last = message.parts[message.parts.length - 1]
  if (last && last.kind === 'reasoning') {
    const parts = message.parts.slice(0, -1)
    parts.push({ ...last, text: (last.text + text).slice(0, REASONING_LIMIT), endedAt: at })
    return { ...message, parts }
  }
  return {
    ...message,
    parts: [
      ...message.parts,
      { kind: 'reasoning', text: text.slice(0, REASONING_LIMIT), startedAt: at, endedAt: at }
    ]
  }
}

function updateStreamingMessage(
  messages: ChatMessage[],
  updater: (message: ChatMessage) => ChatMessage
): ChatMessage[] {
  const index = messages.findIndex((m) => m.status === 'streaming' && m.role === 'assistant')
  if (index === -1) return messages
  const next = messages.slice()
  next[index] = updater(next[index])
  return next
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false
  const raw = value as Record<string, unknown>
  return (
    typeof raw.id === 'string' &&
    (raw.role === 'user' || raw.role === 'assistant') &&
    Array.isArray(raw.parts)
  )
}

/** Restores a stored chat, dropping everything tied to a run that is long gone. */
function reviveSession(value: unknown): ChatSession | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string') return null
  const mode: ChatMode =
    raw.mode === 'chat' || raw.mode === 'plan' ? raw.mode : raw.mode === 'ask' ? 'chat' : 'agent'
  const thinking: ThinkingLevel =
    typeof raw.thinking === 'string' && (THINKING_LEVELS as readonly string[]).includes(raw.thinking)
      ? (raw.thinking as ThinkingLevel)
      : 'off'
  const messages = Array.isArray(raw.messages) ? raw.messages.filter(isChatMessage) : []

  /**
   * Answers written before the context meter existed carry no contextTokens, but
   * they do carry the provider's prompt/completion counts. A reply with no tool
   * part came back in a single request, so its prompt *is* the conversation the
   * provider saw — that one request's numbers are exact, not a guess. Multi-step
   * replies only report a sum, so they are left unknown rather than overstated.
   */
  const restored = messages.map((message) => {
    if (message.role !== 'assistant' || message.contextTokens !== undefined) return message
    if (message.status === 'streaming') return { ...message, status: 'done' as const }
    if (message.parts.some((part) => part.kind === 'tool') || message.promptTokens === undefined) {
      return message
    }
    return { ...message, contextTokens: message.promptTokens + (message.completionTokens ?? 0) }
  })
  const lastContext = [...restored]
    .reverse()
    .find((message) => message.role === 'assistant' && message.contextTokens !== undefined)?.contextTokens
  const contextTokens =
    typeof raw.contextTokens === 'number' && raw.contextTokens > 0
      ? raw.contextTokens
      : (lastContext ?? undefined)

  return {
    id: raw.id,
    title: typeof raw.title === 'string' ? raw.title : '',
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    mode,
    thinking,
    ...(contextTokens !== undefined ? { contextTokens } : {}),
    ...(raw.saved && typeof raw.saved === 'object'
      ? {
          saved: {
            messages: Number((raw.saved as { messages?: unknown }).messages ?? 0) || 0,
            chars: Number((raw.saved as { chars?: unknown }).chars ?? 0) || 0
          }
        }
      : {}),
    messages: restored,
    streaming: false,
    requestId: null,
    todos: [],
    pendingApproval: null,
    pendingQuestion: null,
    notice: null,
    // Queued messages survive a restart, so a night plan keeps its backlog.
    queue: Array.isArray(raw.queue)
      ? (raw.queue as unknown[])
          .filter((item): item is { id: string; text: string; at: number } => {
            const entry = item as { id?: unknown; text?: unknown; at?: unknown }
            return (
              typeof entry?.id === 'string' &&
              typeof entry?.text === 'string' &&
              entry.text.trim().length > 0
            )
          })
          .map((item) => ({ id: item.id, text: item.text, at: typeof item.at === 'number' ? item.at : Date.now() }))
          .slice(0, 50)
      : [],
    paused: false,
    night: raw.night === true
  }
}

function loadSessions(): { chats: ChatSession[]; activeChatId: string } {
  const fresh = (): { chats: ChatSession[]; activeChatId: string } => {
    const chat = newSession(readMode())
    return { chats: [chat], activeChatId: chat.id }
  }
  try {
    const raw = readStored(STORAGE_KEY, LEGACY_STORAGE_KEY)
    if (!raw) return fresh()
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return fresh()
    const data = parsed as { chats?: unknown; activeChatId?: unknown }
    if (!Array.isArray(data.chats)) return fresh()
    const chats = data.chats
      .map(reviveSession)
      .filter((chat): chat is ChatSession => chat !== null)
    if (chats.length === 0) return fresh()
    const activeChatId =
      typeof data.activeChatId === 'string' && chats.some((chat) => chat.id === data.activeChatId)
        ? data.activeChatId
        : chats[0].id
    return { chats, activeChatId }
  } catch {
    return fresh()
  }
}

function persist(state: ChatState): void {
  const chatSettings = useSettingsStore.getState().settings?.chat
  try {
    // Turning history off has to remove what is already on disk, not just stop writing.
    if (chatSettings && !chatSettings.persist) {
      localStorage.removeItem(STORAGE_KEY)
      return
    }
    const limit = chatSettings?.persistLimit ?? 50
    const chats = state.chats.slice(0, limit).map((chat) => ({
      id: chat.id,
      title: chat.title,
      createdAt: chat.createdAt,
      mode: chat.mode,
      thinking: chat.thinking,
      contextTokens: chat.contextTokens,
      saved: chat.saved,
      messages: chat.messages.map((message) => ({
        ...message,
        parts: message.parts.map((part) => {
          if (part.kind === 'tool') return { ...part, detail: part.detail.slice(0, TOOL_DETAIL_LIMIT) }
          // Thoughts are the bulkiest part of a transcript and the least missed,
          // so only their beginning is written to storage.
          if (part.kind === 'reasoning') {
            return { ...part, text: part.text.slice(0, REASONING_STORE_LIMIT) }
          }
          return part
        })
      }))
    }))
    const payload = { activeChatId: state.activeChatId, chats }
    let json = JSON.stringify(payload)
    // Attachment bytes are the bulkiest thing a transcript can hold, so over
    // budget they go first — the chips keep the names, kinds and sizes.
    if (json.length > STORAGE_BUDGET) {
      json = JSON.stringify({
        ...payload,
        chats: chats.map((chat) => ({
          ...chat,
          messages: chat.messages.map((message) => ({
            ...message,
            parts: message.parts.map((part) => {
              if (part.kind === 'attachment' && (part.attachment.dataUrl || part.attachment.frames)) {
                return {
                  ...part,
                  attachment: { ...part.attachment, dataUrl: undefined, frames: undefined }
                }
              }
              // Diff patches and diagram SVGs are bulky payload too — over
              // budget the cards degrade to their title row. Timelapse frames
              // are never stored at all.
              if (part.kind === 'tool') {
                if (part.meta?.kind === 'diff') return { ...part, meta: undefined }
                if (part.meta?.kind === 'timelapse') return { ...part, meta: undefined }
                if (part.meta?.kind === 'diagram' && part.meta.svg.length > 20000) {
                  return { ...part, meta: undefined }
                }
              }
              return part
            })
          }))
        }))
      })
    }
    if (json.length > STORAGE_BUDGET) {
      json = JSON.stringify({
        ...payload,
        chats: chats.map((chat) => ({
          ...chat,
          messages: chat.messages.map((message) => ({
            ...message,
            parts: message.parts.map((part) =>
              part.kind === 'tool' && part.meta?.kind === 'image' ? { ...part, meta: undefined } : part
            )
          }))
        }))
      })
    }
    localStorage.setItem(STORAGE_KEY, json)
  } catch {
    // Storage may be unavailable or full; the chats stay in memory.
  }
}

/** Drops the stored history without touching the chats that are open right now. */
export function clearStoredChats(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

const restored = loadSessions()

export const useChatStore = create<ChatState>((set, get) => {
  /** Applies a change to one chat and re-projects whichever chat is active. */
  const patch = (chatId: string, updater: (chat: ChatSession) => ChatSession): void => {
    set((state) => {
      const chats = state.chats.map((chat) => (chat.id === chatId ? updater(chat) : chat))
      const active = chats.find((chat) => chat.id === state.activeChatId) ?? chats[0]
      return { chats, ...view(active) }
    })
  }

  const activate = (chats: ChatSession[], chat: ChatSession): Partial<ChatState> => ({
    chats,
    activeChatId: chat.id,
    ...view(chat)
  })

  const activeSession = (): ChatSession => {
    const state = get()
    return state.chats.find((chat) => chat.id === state.activeChatId) ?? state.chats[0]
  }

  /** When a run ends, the next queued message of that chat starts on its own. */
  const dispatchQueue = (chatId: string): void => {
    window.setTimeout(() => {
      const state = get()
      // The main process still answers one conversation at a time.
      if (state.chats.some((chat) => chat.streaming)) return
      const chat = state.chats.find((item) => item.id === chatId)
      if (!chat || chat.queue.length === 0) return
      const [next, ...rest] = chat.queue
      patch(chatId, (session) => ({ ...session, queue: rest }))
      void get().send(next.text, chatId)
    }, 80)
  }

  return {
    ...view(restored.chats.find((chat) => chat.id === restored.activeChatId) ?? restored.chats[0]),
    chats: restored.chats,
    activeChatId: restored.activeChatId,
    processes: [],

    newChat: () => {
      const chat = newSession(readMode())
      set((state) => activate([chat, ...state.chats], chat))
      flushPersist()
      return chat.id
    },

    selectChat: (id) => {
      const state = get()
      if (id === state.activeChatId) return
      const chat = state.chats.find((item) => item.id === id)
      if (!chat) return
      set({ activeChatId: id, ...view(chat) })
      flushPersist()
    },

    deleteChat: (id) => {
      const target = get().chats.find((chat) => chat.id === id)
      if (!target) return
      // The run lives in the main process: stop it, otherwise its events have
      // nowhere to land.
      if (target.streaming) window.relaxcode.chat.abort()
      set((state) => {
        const remaining = state.chats.filter((chat) => chat.id !== id)
        if (remaining.length === 0) {
          const chat = newSession(readMode())
          return activate([chat], chat)
        }
        if (state.activeChatId !== id) return { chats: remaining }
        return activate(remaining, remaining[0])
      })
      flushPersist()
    },

    clearAll: () => {
      if (get().chats.some((chat) => chat.streaming)) window.relaxcode.chat.abort()
      clearStoredChats()
      const chat = newSession(readMode())
      set(activate([chat], chat))
      flushPersist()
    },

    setMode: (mode) => {
      try {
        localStorage.setItem(MODE_KEY, mode)
      } catch {
        // ignore
      }
      patch(get().activeChatId, (chat) => ({ ...chat, mode }))
    },

    setThinking: (level) => {
      writeStored(THINKING_KEY, level)
      patch(get().activeChatId, (chat) => ({ ...chat, thinking: level }))
    },

    send: async (text, chatId, attachments) => {
      const trimmed = text.trim()
      const usable = (attachments ?? []).filter((attachment) => attachment.status !== 'error')
      const state = get()
      // The main process runs one conversation at a time.
      if ((!trimmed && usable.length === 0) || state.chats.some((chat) => chat.streaming)) return false
      if (!useSettingsStore.getState().settings?.model) return false

      const active = chatId
        ? (state.chats.find((chat) => chat.id === chatId) ?? activeSession())
        : activeSession()
      const requestId = crypto.randomUUID()
      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        parts: [
          ...usable.map((attachment) => ({ kind: 'attachment', attachment }) as AttachmentPart),
          { kind: 'text', text: trimmed } as TextPart
        ],
        status: 'done',
        at: Date.now()
      }
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        parts: [],
        status: 'streaming',
        at: Date.now()
      }

      const history: ChatMessagePayload[] = active.messages
        .filter((message) => message.status === 'done')
        .map((message) => ({ role: message.role, content: messageText(message) }))
        .filter((message) => message.content.trim() !== '')
        .slice(-(useSettingsStore.getState().settings?.agent.historyMessages ?? HISTORY_LIMIT))
      // Attachments ride along with their own message only — earlier turns
      // already carry their one-line notes inside `messageText`.
      history.push(
        usable.length > 0 ? { role: 'user', content: trimmed, attachments: usable } : { role: 'user', content: trimmed }
      )

      const editorState = useEditorStore.getState()
      const titlesFromMessages = useSettingsStore.getState().settings?.chat.titleFromMessage ?? true

      patch(active.id, (chat) => ({
        ...chat,
        title:
          chat.title ||
          (titlesFromMessages
            ? deriveTitle(trimmed || usable.map((attachment) => attachment.name).join(', '))
            : ''),
        messages: [...chat.messages, userMessage, assistantMessage],
        streaming: true,
        requestId,
        todos: [],
        pendingApproval: null,
        pendingQuestion: null,
        notice: null
      }))

      window.relaxcode.chat
        .send({
          requestId,
          mode: active.mode,
          thinking: active.thinking,
          night: active.night,
          messages: history,
          context: {
            activeFile: editorState.activePath,
            openFiles: editorState.files.map((file) => file.path)
          }
        })
        .catch(() => {
          get().handleEvent({ requestId, type: 'error', message: 'ipc-transport' })
        })

      return true
    },

    stop: () => {
      if (get().chats.some((chat) => chat.streaming)) window.relaxcode.chat.abort()
    },

    enqueue: (text) => {
      const trimmed = text.trim()
      if (trimmed.length === 0) return
      patch(get().activeChatId, (chat) => ({
        ...chat,
        queue: [...chat.queue, { id: crypto.randomUUID(), text: trimmed, at: Date.now() }]
      }))
    },

    queueAction: (id, action, text) => {
      patch(get().activeChatId, (chat) => {
        const index = chat.queue.findIndex((item) => item.id === id)
        if (index < 0) return chat
        const queue = [...chat.queue]
        if (action === 'remove') {
          queue.splice(index, 1)
        } else if (action === 'edit' && text !== undefined && text.trim().length > 0) {
          queue[index] = { ...queue[index], text: text.trim() }
        } else if (action === 'up' && index > 0) {
          ;[queue[index - 1], queue[index]] = [queue[index], queue[index - 1]]
        } else if (action === 'down' && index < queue.length - 1) {
          ;[queue[index + 1], queue[index]] = [queue[index], queue[index + 1]]
        }
        return { ...chat, queue }
      })
    },

    steer: async (text) => {
      const trimmed = text.trim()
      if (trimmed.length === 0) return false
      const chat = activeSession()
      if (!chat.streaming || chat.requestId === null) return false
      const result = await window.relaxcode.chat.steer(trimmed)
      // The transcript entry arrives with the run's own `steer` event.
      return result.injected
    },

    togglePause: () => {
      const chat = activeSession()
      const next = !chat.paused
      patch(chat.id, (session) => ({ ...session, paused: next }))
      void window.relaxcode.chat.pause(next)
    },

    toggleNight: () => {
      const chat = activeSession()
      patch(chat.id, (session) => ({ ...session, night: !session.night }))
    },

    stopProcess: (id) => {
      void window.relaxcode.servers
        .stop(id)
        .then((processes) => set({ processes }))
        .catch(() => {
          // The process may already be gone and the registry unavailable.
        })
    },

    loadProcesses: async () => {
      try {
        const processes = await window.relaxcode.servers.list()
        set({ processes })
      } catch {
        // The process registry is unavailable (e.g. a stale preload); not fatal.
      }
    },

    respondApproval: (decision, editedArgs) => {
      const request = get().pendingApproval
      if (!request) return
      patch(get().activeChatId, (chat) => ({ ...chat, pendingApproval: null }))
      window.relaxcode.chat.respondApproval({
        approvalId: request.approvalId,
        decision,
        ...(editedArgs ? { editedArgs } : {})
      })
    },

    replyQuestion: (text) => {
      const question = get().pendingQuestion
      if (!question) return
      patch(get().activeChatId, (chat) => ({ ...chat, pendingQuestion: null }))
      window.relaxcode.chat.replyUser({ questionId: question.questionId, text })
    },

    handleEvent: (event) => {
      // Events belong to the chat that started the run, not to the visible one.
      const chat = get().chats.find((item) => item.requestId === event.requestId)
      if (!chat) return
      const chatId = chat.id

      switch (event.type) {
        case 'steer': {
          // The interrupted run shows the message in the transcript, marked as
          // a steering interruption rather than a fresh request.
          patch(chatId, (session) => ({
            ...session,
            messages: [
              ...session.messages,
              {
                id: crypto.randomUUID(),
                role: 'user',
                parts: [{ kind: 'text', text: event.text }],
                status: 'done',
                at: Date.now(),
                steered: true
              }
            ]
          }))
          break
        }
        case 'paused': {
          patch(chatId, (session) => ({ ...session, paused: event.paused }))
          break
        }
        case 'delta': {
          patch(chatId, (session) => ({
            ...session,
            messages: updateStreamingMessage(session.messages, (message) =>
              appendText(message, event.text)
            )
          }))
          break
        }
        case 'reasoning': {
          const at = Date.now()
          patch(chatId, (session) => ({
            ...session,
            messages: updateStreamingMessage(session.messages, (message) =>
              appendReasoning(message, event.text, at)
            )
          }))
          break
        }
        case 'reasoning-rewind': {
          patch(chatId, (session) => ({
            ...session,
            messages: updateStreamingMessage(session.messages, (message) => {
              let remaining = event.length
              const parts = message.parts.slice()
              for (let i = parts.length - 1; i >= 0 && remaining > 0; i -= 1) {
                const part = parts[i]
                if (part.kind !== 'reasoning') continue
                const cut = Math.min(remaining, part.text.length)
                remaining -= cut
                const text = part.text.slice(0, part.text.length - cut)
                if (text.length === 0) parts.splice(i, 1)
                else parts[i] = { ...part, text }
              }
              return { ...message, parts }
            })
          }))
          break
        }
        case 'tool-start': {
          patch(chatId, (session) => ({
            ...session,
            messages: updateStreamingMessage(session.messages, (message) => {
              // Providers normally send unique ids, but a repeated id must not
              // silently overwrite an earlier tool card.
              let callId = event.callId
              let suffix = 2
              while (
                message.parts.some((part) => part.kind === 'tool' && part.callId === callId)
              ) {
                callId = `${event.callId}#${suffix}`
                suffix += 1
              }
              return {
                ...message,
                parts: [
                  ...message.parts,
                  {
                    kind: 'tool',
                    callId,
                    name: event.name,
                    args: event.args,
                    status: 'running',
                    summary: '',
                    detail: ''
                  }
                ]
              }
            })
          }))
          break
        }
        case 'tool-meta': {
          patch(chatId, (session) => ({
            ...session,
            messages: updateStreamingMessage(session.messages, (message) => {
              const matches = message.parts.filter(
                (part): part is ToolPart =>
                  part.kind === 'tool' &&
                  (part.callId === event.callId || part.callId.startsWith(`${event.callId}#`))
              )
              const target =
                matches.find((part) => part.status === 'running') ?? matches[matches.length - 1]
              return {
                ...message,
                parts: message.parts.map((part) =>
                  part === target ? { ...part, meta: event.meta } : part
                )
              }
            })
          }))
          break
        }
        case 'tool-result': {
          patch(chatId, (session) => ({
            ...session,
            messages: updateStreamingMessage(session.messages, (message) => {
              const matches = message.parts.filter(
                (part): part is ToolPart =>
                  part.kind === 'tool' &&
                  (part.callId === event.callId || part.callId.startsWith(`${event.callId}#`))
              )
              const target =
                matches.find((part) => part.status === 'running') ?? matches[matches.length - 1]
              return {
                ...message,
                parts: message.parts.map((part) =>
                  part === target
                    ? {
                        ...part,
                        status: event.ok ? 'ok' : 'error',
                        summary: event.summary,
                        detail: event.detail,
                        ...(event.meta ? { meta: event.meta } : {})
                      }
                    : part
                )
              }
            })
          }))
          break
        }
        case 'tool-approval': {
          patch(chatId, (session) => ({ ...session, pendingApproval: event.request }))
          break
        }
        case 'todos': {
          patch(chatId, (session) => ({ ...session, todos: event.todos }))
          break
        }
        case 'run-snapshot': {
          // Time travel: pin the snapshot to the user message that started
          // this run, so the bubble grows a rollback button.
          patch(chatId, (session) => {
            const messages = [...session.messages]
            for (let index = messages.length - 1; index >= 0; index -= 1) {
              if (messages[index].role === 'user') {
                messages[index] = { ...messages[index], snapshot: event.name }
                break
              }
            }
            return { ...session, messages }
          })
          break
        }
        case 'timelapse': {
          // The film of the run lands as a virtual tool part on the answer.
          patch(chatId, (session) => ({
            ...session,
            messages: session.messages.map((message) =>
              message.role === 'assistant' && message.status === 'streaming'
                ? {
                    ...message,
                    parts: [
                      ...message.parts,
                      {
                        kind: 'tool' as const,
                        callId: `timelapse-${event.requestId}`,
                        name: 'timelapse',
                        args: '{}',
                        status: 'ok' as const,
                        summary: `${event.frames.length} frames`,
                        detail: '',
                        meta: { kind: 'timelapse', frames: event.frames, intervalSec: event.intervalSec }
                      }
                    ]
                  }
                : message
            )
          }))
          break
        }
        case 'processes': {
          // Servers are shared by every chat, so this one is not per-chat.
          set({ processes: event.processes })
          break
        }
        case 'user-question': {
          patch(chatId, (session) => ({
            ...session,
            pendingQuestion: {
              questionId: event.questionId,
              question: event.question,
              options: event.options
            }
          }))
          break
        }
        case 'notice': {
          patch(chatId, (session) => ({ ...session, notice: event }))
          break
        }
        case 'text-rewind': {
          // Drop text the model streamed before we recognised it as a tool call.
          patch(chatId, (session) => ({
            ...session,
            messages: updateStreamingMessage(session.messages, (message) => {
              let remaining = event.length
              const parts = message.parts.slice()
              for (let i = parts.length - 1; i >= 0 && remaining > 0; i -= 1) {
                const part = parts[i]
                if (part.kind !== 'text') continue
                const cut = Math.min(remaining, part.text.length)
                remaining -= cut
                const text = part.text.slice(0, part.text.length - cut)
                if (text.length === 0) parts.splice(i, 1)
                else parts[i] = { kind: 'text', text }
              }
              return { ...message, parts }
            })
          }))
          break
        }
        case 'done': {
          patch(chatId, (session) => ({
            ...session,
            streaming: false,
            requestId: null,
            pendingApproval: null,
            pendingQuestion: null,
            // Retry notices are transient; keep the ones that explain the outcome.
            notice:
              session.notice &&
              (session.notice.kind === 'no-tool-calls' ||
                session.notice.kind === 'text-call-fallback' ||
                session.notice.kind === 'no-answer' ||
                session.notice.kind === 'param-dropped' ||
                session.notice.kind === 'unverified-result')
                ? session.notice
                : null,
            // The window is filled by the last answered request, not by the sum
            // of the run's steps, so the newest number wins.
            ...(event.contextTokens !== undefined ? { contextTokens: event.contextTokens } : {}),
            // A fresh answer always describes the fresh request, so a mode that
            // saved nothing (or is off) clears what the previous run reported.
            saved: event.saved,
            messages: updateStreamingMessage(session.messages, (message) => ({
              ...message,
              status: 'done',
              promptTokens: event.promptTokens,
              completionTokens: event.completionTokens,
              reasoningTokens: event.reasoningTokens,
              contextTokens: event.contextTokens
            }))
          }))
          dispatchQueue(chatId)
          break
        }
        case 'error': {
          patch(chatId, (session) => ({
            ...session,
            streaming: false,
            requestId: null,
            pendingApproval: null,
            pendingQuestion: null,
            notice: null,
            messages: updateStreamingMessage(session.messages, (message) => ({
              ...message,
              status: 'error',
              error: event.message
            }))
          }))
          dispatchQueue(chatId)
          break
        }
      }
    },

    reset: () => {
      if (get().streaming) window.relaxcode.chat.abort()
      patch(get().activeChatId, (chat) => ({
        ...chat,
        title: '',
        messages: [],
        streaming: false,
        requestId: null,
        todos: [],
        pendingApproval: null,
        pendingQuestion: null,
        notice: null,
        contextTokens: undefined,
        saved: undefined
      }))
    }
  }
})

// Chats survive a restart. Throttled: the first change schedules one save, so a
// long stream cannot starve it and a burst of deltas cannot flood storage.
let saveTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Writes right away instead of waiting for the throttled save. Deleting,
 * creating or switching a chat is one deliberate action, and a hidden window can
 * have its timers frozen — a delete that never reaches storage would come back
 * on the next launch. Streaming deltas keep using the throttle.
 */
function flushPersist(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  persist(useChatStore.getState())
}

useChatStore.subscribe(() => {
  if (saveTimer !== null) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    persist(useChatStore.getState())
  }, 500)
})
