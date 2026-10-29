import { useMemo, type JSX } from 'react'
import { parseMarkdown, type MdBlock, type MdInline } from '@shared/markdown'
import type { WebSearchSource } from '@shared/web-search'
import type { ChatPart } from '@/stores/chat'

/**
 * Chat markdown: the model's answer gets real typography instead of raw
 * asterisks. Each kind of emphasis gets its own treatment so the eye can
 * scan an answer at a glance: H1 is underlined by a full-width rule, H2
 * carries a left accent bar, H3 is recoloured small caps, bold is picked
 * out with a soft marker fill, italic fades to muted, inline code sits in
 * a thin frame, quotes and code blocks land in tinted boxes and citations
 * stay clickable. Everything degrades silently while the answer streams.
 */

function collectSources(parts: ChatPart[]): Map<number, WebSearchSource> {
  const byNumber = new Map<number, WebSearchSource>()
  for (const part of parts) {
    if (part.kind !== 'tool' || part.name !== 'web_search') continue
    const meta = part.meta
    if (!meta || meta.kind !== 'web-search') continue
    for (const source of meta.sources ?? []) {
      byNumber.set(source.number, source)
    }
  }
  return byNumber
}

function Inline({
  nodes,
  sources
}: {
  nodes: MdInline[]
  sources: Map<number, WebSearchSource>
}): JSX.Element {
  return (
    <>
      {nodes.map((node, index) => {
        if (node.type === 'bold') {
          // Key phrases: a soft marker fill, like a highlighter pen.
          return (
            <strong
              key={index}
              className="rounded bg-foreground/[0.07] px-1 py-px font-semibold text-foreground"
            >
              {node.text}
            </strong>
          )
        }
        if (node.type === 'italic') {
          // Aside and secondary remarks fade to the muted ink.
          return (
            <em key={index} className="italic text-muted-foreground">
              {node.text}
            </em>
          )
        }
        if (node.type === 'code') {
          return (
            <code
              key={index}
              className="rounded border border-border bg-foreground/[0.06] px-1 py-px font-mono text-[11.5px] text-foreground"
            >
              {node.text}
            </code>
          )
        }
        if (node.type === 'cite') {
          const source = sources.get(node.cite)
          if (!source) return <span key={index}>{node.text}</span>
          return (
            <a
              key={index}
              href={source.url}
              target="_blank"
              rel="noreferrer noopener"
              title={`${source.title} — ${source.domain}`}
              className="mx-0.5 inline-flex items-center rounded bg-foreground/[0.06] px-1 py-px align-baseline text-[10px] font-medium tabular-nums text-muted-foreground transition-colors hover:bg-foreground/[0.12] hover:text-foreground"
            >
              {node.cite}
            </a>
          )
        }
        return <span key={index}>{node.text}</span>
      })}
    </>
  )
}

export function Markdown({
  text,
  parts
}: {
  text: string
  parts: ChatPart[]
}): JSX.Element {
  const sources = useMemo(() => collectSources(parts), [parts])
  const blocks = useMemo(() => parseMarkdown(text), [text])

  return (
    <div className="flex flex-col gap-1.5" data-testid="chat-markdown">
      {blocks.map((block, index) => (
        <MarkdownBlock key={index} block={block} sources={sources} />
      ))}
    </div>
  )
}

function MarkdownBlock({
  block,
  sources
}: {
  block: MdBlock
  sources: Map<number, WebSearchSource>
}): JSX.Element {
  if (block.type === 'code') {
    return (
      <pre className="overflow-x-auto rounded-lg border border-border bg-foreground/[0.04] p-2.5 font-mono text-[11.5px] leading-relaxed text-foreground">
        {block.lang.length > 0 && (
          <span className="mb-1 block text-[9.5px] uppercase tracking-wide text-tertiary">
            {block.lang}
          </span>
        )}
        <code className="whitespace-pre">{block.text}</code>
      </pre>
    )
  }
  if (block.type === 'quote') {
    // A framed callout: this is where "второстепенная информация" lands when
    // the model wraps it in a quote.
    return (
      <blockquote className="rounded-r-lg border-l-2 border-l-primary/60 bg-primary/[0.06] px-3 py-2 text-[12.5px] text-muted-foreground">
        {block.lines.map((line, index) => (
          <p key={index} className="whitespace-pre-wrap break-words">
            <Inline nodes={line} sources={sources} />
          </p>
        ))}
      </blockquote>
    )
  }
  if (block.type === 'h') {
    const content = <Inline nodes={block.lines[0] ?? []} sources={sources} />
    // Every level gets its own device: a rule under H1, an accent bar for
    // H2, recoloured small caps for H3.
    if (block.level === 1) {
      return (
        <p className="mt-2 border-b border-border pb-1 text-[16px] font-bold text-foreground">
          {content}
        </p>
      )
    }
    if (block.level === 2) {
      return (
        <p className="mt-1.5 border-l-2 border-foreground/30 pl-2 text-[14.5px] font-semibold text-foreground">
          {content}
        </p>
      )
    }
    return (
      <p className="mt-1 text-[11.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
        {content}
      </p>
    )
  }
  if (block.type === 'ul' || block.type === 'ol') {
    const items = block.items.map((item, index) => (
      <li key={index} className="whitespace-pre-wrap break-words pl-1">
        <Inline nodes={item} sources={sources} />
      </li>
    ))
    return block.type === 'ul' ? (
      <ul className="ml-4 list-disc space-y-0.5 marker:text-tertiary">{items}</ul>
    ) : (
      <ol className="ml-4 list-decimal space-y-0.5 marker:text-tertiary" start={block.start}>
        {items}
      </ol>
    )
  }
  return (
    <p className="whitespace-pre-wrap break-words">
      {block.lines.map((line, index) => (
        <span key={index}>
          {index > 0 && <br />}
          <Inline nodes={line} sources={sources} />
        </span>
      ))}
    </p>
  )
}
