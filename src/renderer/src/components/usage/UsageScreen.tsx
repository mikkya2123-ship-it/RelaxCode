import { useEffect, useMemo, useState, type JSX } from 'react'
import { X } from 'lucide-react'
import { useChatStore, type ChatSession } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import {
  BarList,
  ContextLineChart,
  TokenBarsChart,
  grouped,
  type BarListItem,
  type TokenBarDatum
} from './charts'

/**
 * The detailed report behind the context ring: where every token went.
 *
 * All numbers come from the provider's own usage reports, attached to each
 * answer as it finished — nothing here is re-counted locally, so a figure can
 * always be traced back to a specific answer in a specific chat. Estimates
 * (characters → tokens for the savings) keep the "≈" mark for the same reason.
 */

/** Local time of an answer, 24-hour, without seconds. */
const formatTime = (at: number): string =>
  new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

/** 1234 → "1 234"; grouping comes from the system locale. */
const percent = (part: number, whole: number): number =>
  whole > 0 ? Math.round((part / whole) * 100) : 0

interface AnswerRow {
  /** 1-based position among the chat's answers; the charts' x axis. */
  index: number
  at?: number
  prompt: number | null
  completion: number | null
  reasoning: number | null
  context: number | null
  tools: number
  toolErrors: number
  chars: number
}

/** One row per model answer, in the order the chat wrote them. */
function rowsOf(chat: ChatSession): AnswerRow[] {
  let index = 0
  return chat.messages
    .filter((message) => message.role === 'assistant')
    .map((message) => {
      index += 1
      const tools = message.parts.filter((part) => part.kind === 'tool')
      return {
        index,
        ...(message.at !== undefined ? { at: message.at } : {}),
        prompt: message.promptTokens ?? null,
        completion: message.completionTokens ?? null,
        reasoning: message.reasoningTokens ?? null,
        context: message.contextTokens ?? null,
        tools: tools.length,
        toolErrors: tools.filter((part) => part.kind === 'tool' && part.status === 'error').length,
        chars: message.parts.reduce(
          (n, part) => n + (part.kind === 'text' ? part.text.length : 0),
          0
        )
      }
    })
}

interface ChatTotals {
  title: string
  prompt: number
  completion: number
}

function totalsOf(chat: ChatSession): ChatTotals {
  const rows = rowsOf(chat)
  return {
    title: chat.title,
    prompt: rows.reduce((n, row) => n + (row.prompt ?? 0), 0),
    completion: rows.reduce((n, row) => n + (row.completion ?? 0), 0)
  }
}

interface ToolStat {
  name: string
  ok: number
  error: number
}

function toolsOf(chats: ChatSession[]): ToolStat[] {
  const byName = new Map<string, ToolStat>()
  for (const chat of chats) {
    for (const message of chat.messages) {
      if (message.role !== 'assistant') continue
      for (const part of message.parts) {
        if (part.kind !== 'tool') continue
        const stat = byName.get(part.name) ?? { name: part.name, ok: 0, error: 0 }
        if (part.status === 'error') stat.error += 1
        else stat.ok += 1
        byName.set(part.name, stat)
      }
    }
  }
  return [...byName.values()].sort((a, b) => b.ok + b.error - (a.ok + a.error))
}

function Card({
  title,
  children,
  note
}: {
  title: string
  children: JSX.Element | JSX.Element[]
  note?: string
}): JSX.Element {
  return (
    <section className="rounded-xl border border-border bg-card p-3">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {children}
      {note && <p className="mt-2 text-[11px] leading-relaxed text-tertiary">{note}</p>}
    </section>
  )
}

function SummaryCard({
  label,
  value,
  note
}: {
  label: string
  value: string
  note?: string
}): JSX.Element {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-border bg-card p-2.5">
      <span className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="truncate text-[15px] font-semibold tabular-nums text-foreground">{value}</span>
      {note && <span className="text-[11px] tabular-nums text-tertiary">{note}</span>}
    </div>
  )
}

export function UsageScreen(): JSX.Element {
  const close = useUiStore((s) => s.closeUsage)
  const chats = useChatStore((s) => s.chats)
  const activeChatId = useChatStore((s) => s.activeChatId)
  const model = useSettingsStore((s) => s.settings?.model ?? null)
  const modelInfo = useSettingsStore((s) => s.models.find((entry) => entry.id === s.settings?.model))
  // The report lives beside the chat, so it follows the chat's own width.
  const chatWidth = useSettingsStore((s) => s.settings?.ui.chatWidth ?? 384)
  const t = useT()

  const [scope, setScope] = useState<'chat' | 'all'>('chat')
  const active = chats.find((chat) => chat.id === activeChatId) ?? chats[0]
  const scopeChats = scope === 'chat' && active ? [active] : chats

  // Escape leaves the report before it leaves the tooltip or anything else.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [close])

  const rows = useMemo(() => scopeChats.flatMap(rowsOf), [scope, chats, activeChatId])
  const reported = rows.filter((row) => row.prompt !== null || row.completion !== null)
  const totalPrompt = rows.reduce((n, row) => n + (row.prompt ?? 0), 0)
  const totalCompletion = rows.reduce((n, row) => n + (row.completion ?? 0), 0)
  const totalReasoning = rows.reduce((n, row) => n + (row.reasoning ?? 0), 0)
  const totalTokens = totalPrompt + totalCompletion
  const toolCalls = rows.reduce((n, row) => n + row.tools, 0)
  const toolErrors = rows.reduce((n, row) => n + row.toolErrors, 0)
  const savedMessages = scopeChats.reduce((n, chat) => n + (chat.saved?.messages ?? 0), 0)
  const savedChars = scopeChats.reduce((n, chat) => n + (chat.saved?.chars ?? 0), 0)
  const savedTokens = savedChars > 0 ? Math.max(1, Math.round(savedChars / 3)) : 0

  const contextNow = active?.contextTokens ?? null
  const contextLimit = modelInfo?.contextLength ?? null
  const limitKnown = typeof contextLimit === 'number' && contextLimit > 0

  const barData: TokenBarDatum[] = reported.map((row) => ({
    label: `#${row.index}${row.at !== undefined ? ` · ${formatTime(row.at)}` : ''}`,
    prompt: row.prompt ?? 0,
    completion: row.completion ?? 0,
    reasoning: row.reasoning ?? 0
  }))

  const chatItems: BarListItem[] = scopeChats
    .map(totalsOf)
    .filter((chat) => chat.prompt + chat.completion > 0)
    .sort((a, b) => b.prompt + b.completion - (a.prompt + a.completion))
    .slice(0, 8)
    .map((chat) => ({
      label: chat.title || t('usage.untitled'),
      parts: [
        { value: chat.prompt, className: 'bg-primary' },
        { value: chat.completion, className: 'bg-[var(--tertiary)]' }
      ],
      value: grouped(chat.prompt + chat.completion),
      note: `${grouped(chat.prompt)} → ${grouped(chat.completion)}`
    }))

  const toolItems: BarListItem[] = toolsOf(scopeChats)
    .slice(0, 12)
    .map((tool) => ({
      label: tool.name,
      parts: [
        { value: tool.ok, className: 'bg-primary' },
        { value: tool.error, className: 'bg-destructive' }
      ],
      value: grouped(tool.ok + tool.error),
      ...(tool.error > 0 ? { note: t('usage.failed', { n: tool.error }) } : {})
    }))

  const largest = rows.reduce<AnswerRow | null>(
    (best, row) => (best === null || row.chars > best.chars ? row : best),
    null
  )

  const contextValue = contextNow === null
    ? '—'
    : limitKnown
      ? t('chat.context.used', {
          used: grouped(contextNow),
          limit: grouped(contextLimit as number)
        })
      : t('chat.context.usedOnly', { used: grouped(contextNow) })

  return (
    <aside
      style={{ width: chatWidth }}
      className="relative h-full shrink-0 border-l border-border bg-background"
      data-testid="usage-screen"
      aria-label={t('usage.title')}
    >
      <div className="flex h-full flex-col" style={{ width: chatWidth }}>
        <header className="flex h-9 shrink-0 items-center gap-1.5 px-2">
          <span className="truncate text-xs font-semibold text-foreground">{t('usage.title')}</span>
          <span className="ml-auto inline-flex shrink-0 overflow-hidden rounded-md border border-border text-[11px]">
            {(['chat', 'all'] as const).map((value) => (
              <button
                key={value}
                type="button"
                data-testid={`usage-scope-${value}`}
                onClick={() => setScope(value)}
                className={cn(
                  'px-2 py-0.5 transition-colors duration-100',
                  scope === value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
              >
                {t(value === 'chat' ? 'usage.scope.chat' : 'usage.scope.all')}
              </button>
            ))}
          </span>
          <button
            type="button"
            data-testid="usage-close"
            title={t('action.close')}
            aria-label={t('action.close')}
            onClick={close}
            className="shrink-0 rounded-md p-1 text-tertiary transition-colors duration-100 hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            <X className="size-3.5" />
          </button>
        </header>

      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="usage-body">
        <div className="flex flex-col gap-3 px-3 pb-3">
          {model && (
            <p className="truncate text-[11px] text-tertiary">
              {t('usage.model')}: {model}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <SummaryCard
              label={t('usage.card.input')}
              value={grouped(totalPrompt)}
              note={t('usage.share', { percent: percent(totalPrompt, totalTokens) })}
            />
            <SummaryCard
              label={t('usage.card.output')}
              value={grouped(totalCompletion)}
              note={t('usage.share', { percent: percent(totalCompletion, totalTokens) })}
            />
            <SummaryCard
              label={t('usage.card.reasoning')}
              value={grouped(totalReasoning)}
              note={t('usage.share', { percent: percent(totalReasoning, totalCompletion) })}
            />
            <SummaryCard label={t('usage.card.context')} value={contextValue} />
            <SummaryCard
              label={t('usage.card.answers')}
              value={grouped(reported.length)}
              note={
                reported.length === rows.length
                  ? t('usage.toolsTotal', { n: toolCalls })
                  : t('usage.toolsTotalOf', { n: toolCalls, missing: rows.length - reported.length })
              }
            />
            <SummaryCard
              label={t('usage.card.saved')}
              value={savedMessages > 0 ? `≈${grouped(savedTokens)}` : '—'}
              note={
                savedMessages > 0
                  ? t('usage.saved.messages', { messages: savedMessages })
                  : t('usage.saved.none')
              }
            />
          </div>

          <Card title={t('usage.chart.tokens')}>
            {reported.length > 0 ? (
              <>
                <div className="mb-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2.5 rounded-[3px] bg-primary" />
                    {t('usage.legend.prompt')}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2.5 rounded-[3px] bg-[var(--tertiary)]" />
                    {t('usage.legend.completion')}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2.5 rounded-[3px] bg-amber-500" />
                    {t('usage.legend.reasoning')}
                  </span>
                </div>
                <TokenBarsChart data={barData} legend={{
                  prompt: t('usage.legend.prompt'),
                  completion: t('usage.legend.completion'),
                  reasoning: t('usage.legend.reasoning')
                }} />
                <p className="mt-1 text-[11px] text-tertiary">{t('usage.chart.axisHint')}</p>
              </>
            ) : (
              <p className="py-6 text-center text-[13px] text-muted-foreground">
                {t('usage.chart.tokens.empty')}
              </p>
            )}
          </Card>

          <Card title={t('usage.chart.context')}>
            {rows.some((row) => row.context !== null) ? (
              <>
                <ContextLineChart
                  values={rows.map((row) => row.context)}
                  limit={contextLimit}
                  limitLabel={
                    limitKnown ? t('usage.chart.limit', { n: grouped(contextLimit as number) }) : ''
                  }
                />
                <p className="mt-1 text-[11px] text-tertiary">{t('usage.chart.context.hint')}</p>
              </>
            ) : (
              <p className="py-6 text-center text-[13px] text-muted-foreground">
                {t('usage.chart.context.empty')}
              </p>
            )}
          </Card>

          <Card title={t('usage.chart.chats')}>
            {chatItems.length > 0 ? (
              <>
                <BarList items={chatItems} />
                <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2.5 rounded-[3px] bg-primary" />
                    {t('usage.legend.prompt')}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2.5 rounded-[3px] bg-[var(--tertiary)]" />
                    {t('usage.legend.completion')}
                  </span>
                </div>
              </>
            ) : (
              <p className="py-6 text-center text-[13px] text-muted-foreground">
                {t('usage.chart.chats.empty')}
              </p>
            )}
          </Card>

          <Card title={t('usage.chart.tools')}>
            {toolItems.length > 0 ? (
              <>
                <BarList items={toolItems} />
                {toolErrors > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-2.5 rounded-[3px] bg-primary" />
                      {t('usage.toolsOk')}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-2.5 rounded-[3px] bg-destructive" />
                      {t('usage.toolsFailed')}
                    </span>
                  </div>
                )}
              </>
            ) : (
              <p className="py-6 text-center text-[13px] text-muted-foreground">
                {t('usage.chart.tools.empty')}
              </p>
            )}
          </Card>

          {reported.length > 0 && (
            <Card title={t('usage.avg.title')}>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <SummaryCard
                  label={t('usage.avg.input')}
                  value={grouped(totalPrompt / reported.length)}
                />
                <SummaryCard
                  label={t('usage.avg.output')}
                  value={grouped(totalCompletion / reported.length)}
                />
                <SummaryCard
                  label={t('usage.avg.tools')}
                  value={(toolCalls / Math.max(1, rows.length)).toFixed(1)}
                />
                <SummaryCard
                  label={t('usage.avg.largest')}
                  value={
                    largest
                      ? t('usage.avg.largestValue', {
                          chars: grouped(largest.chars),
                          tokens: grouped(largest.chars / 3)
                        })
                      : '—'
                  }
                />
              </div>
            </Card>
          )}

          <Card title={t('usage.table.title')}>
            {rows.length > 0 ? (
              <div className="max-h-[320px] overflow-auto">
                <table className="w-full min-w-[520px] border-collapse text-[12px] tabular-nums">
                  <thead className="sticky top-0 bg-card">
                    <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="py-1.5 pr-3 font-medium">№</th>
                      <th className="py-1.5 pr-3 font-medium">{t('usage.table.time')}</th>
                      <th className="py-1.5 pr-3 text-right font-medium">
                        {t('usage.legend.prompt')}
                      </th>
                      <th className="py-1.5 pr-3 text-right font-medium">
                        {t('usage.legend.completion')}
                      </th>
                      <th className="py-1.5 pr-3 text-right font-medium">
                        {t('usage.legend.reasoning')}
                      </th>
                      <th className="py-1.5 pr-3 text-right font-medium">
                        {t('usage.table.context')}
                      </th>
                      <th className="py-1.5 pr-3 text-right font-medium">
                        {t('usage.table.tools')}
                      </th>
                      <th className="py-1.5 text-right font-medium">{t('usage.table.chars')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...rows].reverse().map((row) => (
                      <tr key={row.index} className="border-t border-border text-foreground">
                        <td className="py-1.5 pr-3 text-muted-foreground">{row.index}</td>
                        <td className="py-1.5 pr-3 text-muted-foreground">
                          {row.at !== undefined ? formatTime(row.at) : '—'}
                        </td>
                        <td className="py-1.5 pr-3 text-right">{grouped(row.prompt ?? 0)}</td>
                        <td className="py-1.5 pr-3 text-right">{grouped(row.completion ?? 0)}</td>
                        <td className="py-1.5 pr-3 text-right text-amber-500">
                          {row.reasoning ? grouped(row.reasoning) : '—'}
                        </td>
                        <td className="py-1.5 pr-3 text-right">
                          {row.context !== null ? grouped(row.context) : '—'}
                        </td>
                        <td className="py-1.5 pr-3 text-right">
                          {row.tools === 0
                            ? '—'
                            : row.toolErrors > 0
                              ? `${row.tools} (${row.toolErrors} ✗)`
                              : String(row.tools)}
                        </td>
                        <td className="py-1.5 text-right text-muted-foreground">
                          {grouped(row.chars)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="py-6 text-center text-[13px] text-muted-foreground">
                {t('usage.table.empty')}
              </p>
            )}
          </Card>

          <p className="pb-2 text-[11px] leading-relaxed text-tertiary">{t('usage.note.source')}</p>
        </div>
      </div>
    </div>
    </aside>
  )
}
