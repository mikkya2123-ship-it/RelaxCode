import { useState, type JSX } from 'react'
import {
  BookOpenText,
  Check,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  Globe2,
  Loader2,
  Search,
  X
} from 'lucide-react'
import type { ChatPart, ToolPart } from '@/stores/chat'
import { useT } from '@/lib/i18n'
import type { TKey } from '@shared/i18n'
import { safeHttpUrl, type WebSearchMeta, type WebSearchSource } from '@shared/web-search'
import { cn } from '@/lib/utils'

/** Turns the raw page error from the main process into a short, localized line. */
function pageErrorKey(error: string): TKey {
  const text = error.toLowerCase()
  if (/no readable text|has no text/.test(text)) return 'chat.search.pageError.noText'
  if (/http 404/.test(text)) return 'chat.search.pageError.notFound'
  if (/http \d/.test(text)) return 'chat.search.pageError.blocked'
  if (/not text|unsupported content type/.test(text)) return 'chat.search.pageError.notText'
  if (/timeout|timed out|aborted/.test(text)) return 'chat.search.pageError.timeout'
  if (/dns/.test(text)) return 'chat.search.pageError.dns'
  if (/redirect/.test(text)) return 'chat.search.pageError.redirects'
  if (/private address|local network/.test(text)) return 'chat.search.pageError.private'
  return 'chat.search.pageError.generic'
}

/** Reads the query even when the run predates structured meta or is still starting. */
function queryOf(part: ToolPart, meta: WebSearchMeta | null): string {
  if (meta?.query) return meta.query
  try {
    const args = JSON.parse(part.args) as Record<string, unknown>
    return typeof args.query === 'string' ? args.query : ''
  } catch {
    return ''
  }
}

function sourcesOf(meta: WebSearchMeta | null): WebSearchSource[] {
  return Array.isArray(meta?.sources) ? meta.sources.filter((source) => !!safeHttpUrl(source.url)) : []
}

function stageLabel(t: ReturnType<typeof useT>, part: ToolPart, meta: WebSearchMeta | null): string {
  if (meta?.stage === 'error' || part.status === 'error') return t('chat.search.failed')
  if (meta?.stage === 'done') return t('chat.search.done')
  if (meta?.stage === 'reading') return t('chat.search.reading')
  if (meta?.stage === 'searching') return t('chat.search.searching')
  return part.status === 'running' ? t('chat.search.searching') : t('chat.search.done')
}

function statusLabel(t: ReturnType<typeof useT>, source: WebSearchSource): string {
  switch (source.status) {
    case 'reading':
      return t('chat.search.statusReading')
    case 'read':
      return t('chat.search.statusRead')
    case 'failed':
      return t('chat.search.statusFailed')
    default:
      return t('chat.search.statusFound')
  }
}

function formatChars(value: number): string {
  return new Intl.NumberFormat().format(value)
}

/**
 * A search is a first-class activity, not a generic tool call: the user sees the
 * exact query, the provider, every source the agent found and what it read.
 */
export function WebSearchCard({
  part,
  defaultExpanded = false
}: {
  part: ToolPart
  defaultExpanded?: boolean
}): JSX.Element {
  const t = useT()
  const meta = part.meta?.kind === 'web-search' ? part.meta : null
  const query = queryOf(part, meta)
  const sources = sourcesOf(meta)
  const failed = meta?.stage === 'error' || part.status === 'error'
  const running =
    !failed &&
    (part.status === 'running' || meta?.stage === 'searching' || meta?.stage === 'reading')
  const read = sources.filter((source) => source.status === 'read').length
  const [expanded, setExpanded] = useState(defaultExpanded || running)

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border bg-panel/70 transition-colors',
        failed ? 'border-destructive/35' : 'border-border',
        running && 'border-ring/35'
      )}
      data-testid="web-search-card"
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors duration-100 hover:bg-foreground/[0.03]"
      >
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-lg border',
            failed
              ? 'border-destructive/25 bg-destructive/10 text-destructive'
              : 'border-border bg-foreground/[0.04] text-foreground/75',
            running && 'border-ring/25 bg-accent/50'
          )}
        >
          {failed ? (
            <CircleAlert className="size-3.5" />
          ) : running ? (
            <Search className="size-3.5 animate-pulse" />
          ) : (
            <Globe2 className="size-3.5" />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground/90">
              {stageLabel(t, part, meta)}
            </span>
            {running && <Loader2 className="size-3 shrink-0 animate-spin text-tertiary" />}
            {!running && !failed && <Check className="size-3 shrink-0 text-success" />}
            {meta?.provider && (
              <span className="shrink-0 text-[10px] text-tertiary">
                {t('chat.search.provider', { provider: meta.provider })}
              </span>
            )}
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="min-w-0 flex-1 truncate">{query || t('chat.search.query')}</span>
            {sources.length > 0 && (
              <span className="ml-auto flex shrink-0 items-center gap-1 text-[10px] tabular-nums text-tertiary">
                <span>{t('chat.search.found', { count: sources.length })}</span>
                {read > 0 && (
                  <span>· {t('chat.search.pagesRead', { read, total: sources.length })}</span>
                )}
              </span>
            )}
          </span>
        </span>

        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 text-tertiary transition-transform duration-150',
            expanded && 'rotate-90'
          )}
        />
      </button>

      {expanded && (
        <div className="animate-fade-in">
          {failed && (
            <p className="flex items-start gap-1.5 px-3 py-2 text-[11px] text-destructive">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
              <span className="break-words">
                {t('chat.search.failedHint')}
                {(meta?.error || part.summary) && (
                  <span className="mt-0.5 block text-[10px] text-tertiary">
                    {meta?.error ?? part.summary}
                  </span>
                )}
              </span>
            </p>
          )}

          {running && sources.length === 0 && !failed && (
            <div className="flex items-center gap-2 px-3 py-2.5 text-[11px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin text-tertiary" />
              {meta?.stage === 'reading'
                ? t('chat.search.readingPage')
                : t('chat.search.searching')}
            </div>
          )}

          {!running && !failed && sources.length === 0 && (
            <p className="px-3 py-2.5 text-[11px] text-muted-foreground">
              {t('chat.search.noResults')}
            </p>
          )}

          {sources.length > 0 && (
            <div className="max-h-80 overflow-y-auto px-1.5 py-1">
              {sources.map((source) => (
                <SourceRow key={`${source.number}-${source.url}`} source={source} />
              ))}
            </div>
          )}

          {sources.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-[10px] text-tertiary">
              <span>{t('chat.search.sourceCount', { count: sources.length })}</span>
              {read > 0 && (
                <>
                  <span>·</span>
                  <span>{t('chat.search.pagesRead', { read, total: sources.length })}</span>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SourceRow({ source }: { source: WebSearchSource }): JSX.Element {
  const t = useT()
  const href = safeHttpUrl(source.url)
  const content = (
    <>
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border border-border bg-foreground/[0.04] text-[10px] font-medium tabular-nums text-muted-foreground">
        {source.number}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start gap-1.5">
          <span className="line-clamp-1 min-w-0 flex-1 text-[11.5px] font-medium leading-snug text-foreground/90">
            {source.title || source.domain}
          </span>
          {href && (
            <ExternalLink className="mt-0.5 size-3 shrink-0 text-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
          )}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-tertiary">
          <span className="truncate">{source.domain}</span>
          <span>·</span>
          <span
            className={cn(
              'inline-flex items-center gap-1',
              source.status === 'read' && 'text-success',
              source.status === 'failed' && 'text-destructive',
              source.status === 'reading' && 'text-foreground/70'
            )}
          >
            {source.status === 'reading' && <Loader2 className="size-2.5 animate-spin" />}
            {source.status === 'read' && <BookOpenText className="size-2.5" />}
            {source.status === 'failed' && <X className="size-2.5" />}
            {statusLabel(t, source)}
            {source.status === 'read' && source.chars !== undefined && (
              <> · {t('chat.search.pageRead', { chars: formatChars(source.chars) })}</>
            )}
          </span>
        </span>
        {source.snippet && (
          <span className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
            {source.snippet}
          </span>
        )}
        {source.status === 'read' && source.excerpt && (
          <span className="mt-1.5 line-clamp-2 border-l-2 border-ring/30 pl-2 text-[10.5px] leading-relaxed text-tertiary">
            {source.excerpt}
          </span>
        )}
        {source.status === 'failed' && source.error && (
          <span
            className="mt-1 line-clamp-1 text-[10px] text-destructive/80"
            title={source.error}
          >
            {t(pageErrorKey(source.error))}
          </span>
        )}
      </span>
    </>
  )

  if (!href) {
    return <div className="flex gap-2 rounded-lg px-1.5 py-1.5">{content}</div>
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      title={t('chat.search.open')}
      className="group flex gap-2 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-foreground/[0.04]"
    >
      {content}
    </a>
  )
}

/**
 * A compact source strip under an answer. Numbers match the ones the search
 * cards and the model's `[n]` citations use for this run.
 */
interface FooterSource {
  url: string
  title: string
  domain: string
  numbers: number[]
}

/** Every citated page in a message, grouped by URL and ordered by first number. */
function collectSearchSources(parts: ChatPart[]): FooterSource[] {
  const byUrl = new Map<string, FooterSource>()
  for (const part of parts) {
    if (part.kind !== 'tool' || part.name !== 'web_search' || part.meta?.kind !== 'web-search') continue
    for (const source of sourcesOf(part.meta ?? null)) {
      const group = byUrl.get(source.url)
      if (group) {
        if (!group.numbers.includes(source.number)) group.numbers.push(source.number)
      } else {
        byUrl.set(source.url, {
          url: source.url,
          title: source.title || source.domain,
          domain: source.domain,
          numbers: [source.number]
        })
      }
    }
  }
  return [...byUrl.values()].sort((a, b) => a.numbers[0] - b.numbers[0])
}

/**
 * Assistant prose with `[n]` citations turned into the same numbered pills the
 * source footer uses. Anything that is not a real source stays untouched.
 */
export function AnswerWithCitations({
  text,
  parts
}: {
  text: string
  parts: ChatPart[]
}): JSX.Element {
  const t = useT()
  const byNumber = new Map<number, FooterSource>()
  for (const source of collectSearchSources(parts)) {
    for (const number of source.numbers) byNumber.set(number, source)
  }
  if (byNumber.size === 0) return <>{text}</>

  const nodes: Array<string | JSX.Element> = []
  const pattern = /\[(\d{1,2})\]/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    const source = byNumber.get(Number(match[1]))
    if (!source) continue
    if (match.index > last) nodes.push(text.slice(last, match.index))
    nodes.push(
      <a
        key={`${match.index}-${match[1]}`}
        href={source.url}
        target="_blank"
        rel="noreferrer noopener"
        title={`${source.title} — ${t('chat.search.open')}`}
        className="mx-0.5 inline-flex items-center rounded bg-foreground/[0.06] px-1 py-px align-baseline text-[10px] font-medium tabular-nums text-muted-foreground transition-colors hover:bg-foreground/[0.12] hover:text-foreground"
      >
        {match[1]}
      </a>
    )
    last = pattern.lastIndex
  }
  if (last === 0) return <>{text}</>
  if (last < text.length) nodes.push(text.slice(last))
  return <>{nodes}</>
}

export function WebSourcesFooter({ parts }: { parts: ChatPart[] }): JSX.Element | null {
  const t = useT()
  const sources = collectSearchSources(parts)
  if (sources.length === 0) return null
  const visible = sources.slice(0, 8)

  return (
    <div className="mt-0.5 flex flex-col gap-1.5" data-testid="web-sources-footer">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-tertiary">
        <BookOpenText className="size-3" />
        {t('chat.search.footer')}
      </div>
      <div className="flex flex-wrap gap-1">
        {visible.map((source) => {
          const href = safeHttpUrl(source.url)
          const label = (
            <>
              <span className="flex items-center gap-0.5">
                {source.numbers.map((number) => (
                  <span
                    key={number}
                    className="rounded bg-foreground/[0.06] px-0.5 tabular-nums text-tertiary"
                  >
                    {number}
                  </span>
                ))}
              </span>
              <span className="max-w-36 truncate">{source.domain}</span>
            </>
          )
          const className =
            'inline-flex items-center gap-1 rounded-md border border-border bg-foreground/[0.02] px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-ring/40 hover:text-foreground'
          return href ? (
            <a
              key={source.url}
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              title={`${source.title} — ${t('chat.search.footerHint')}`}
              className={className}
            >
              {label}
            </a>
          ) : (
            <span key={source.url} className={className}>
              {label}
            </span>
          )
        })}
        {sources.length > visible.length && (
          <span className="inline-flex items-center rounded-md border border-dashed border-border px-1.5 py-0.5 text-[10px] text-tertiary">
            +{sources.length - visible.length}
          </span>
        )}
      </div>
    </div>
  )
}
