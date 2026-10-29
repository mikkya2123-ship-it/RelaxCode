import type { JSX } from 'react'
import { ProviderLogo } from '@/components/ui/provider-logo'
import { cn } from '@/lib/utils'

interface ModelFamily {
  match: RegExp
  /** Provider mark that stands for the family. */
  logo?: string
  /** Short label for families with no bundled mark. */
  label?: string
  /** Brand colour of the tile behind the mark. */
  color: string
}

/**
 * Model ids are vendor-prefixed on most endpoints (`openai/gpt-5`,
 * `anthropic/claude-…`), but a local endpoint often returns a bare name
 * (`llama3.2`). The order matters: the first matching family wins.
 */
const FAMILIES: readonly ModelFamily[] = [
  {
    match: /(^|\/)(gpt|chatgpt|davinci|whisper|text-embedding|codex)|(^|\/)(o1|o3|o4)(-|$)/i,
    logo: 'openai',
    color: '#0f9d78'
  },
  { match: /claude|anthropic/i, logo: 'anthropic', color: '#c15f3c' },
  { match: /(^|\/)(gemini|gemma|palm|bison)(-|\/|$)|google/i, logo: 'google', color: '#4285f4' },
  { match: /deepseek/i, logo: 'deepseek', color: '#4d6bfe' },
  { match: /qwen|qwq|qvq/i, logo: 'alibaba', color: '#6b4fbb' },
  // `nvidia/llama-…-nemotron` carries "llama" too, so the vendor wins first.
  { match: /nemotron|nvidia/i, logo: 'nvidia', color: '#5a8f00' },
  { match: /llama|meta-llama/i, logo: 'meta', color: '#0866ff' },
  {
    match: /mistral|mixtral|codestral|devstral|ministral|pixtral|magistral/i,
    logo: 'mistral',
    color: '#e04300'
  },
  { match: /(^|\/)(grok|x-ai|xai)(-|\/|$)/i, logo: 'xai', color: '#111827' },
  { match: /kimi|moonshot/i, logo: 'moonshotai', color: '#1f2937' },
  { match: /(^|\/)(z-ai|zai)(\/|-|$)/i, logo: 'zai', color: '#3b5bff' },
  { match: /glm|chatglm|zhipu/i, logo: 'zhipuai', color: '#3859ff' },
  { match: /command|cohere/i, logo: 'cohere', color: '#39594d' },
  { match: /jamba|ai21/i, logo: 'ai21', color: '#e6007a' },
  { match: /sonar|perplexity/i, logo: 'perplexity', color: '#20808d' },
  { match: /(^|\/)nova(-|\/|$)/i, logo: 'nova', color: '#d97706' },
  { match: /step-?fun/i, logo: 'stepfun', color: '#0084ff' },
  { match: /solar|upstage/i, logo: 'upstage', color: '#6d28d9' },
  { match: /openrouter/i, logo: 'openrouter', color: '#6366f1' },
  { match: /(^|\/)phi(\d+)?(-|\/|$)|microsoft/i, label: 'MS', color: '#0078d4' },
  { match: /ernie|baidu/i, label: 'BD', color: '#2932e1' },
  { match: /hunyuan|tencent/i, label: 'T', color: '#0052d9' },
  { match: /doubao|bytedance|seed-oss/i, label: 'DB', color: '#2563eb' },
  { match: /minimax|abab/i, label: 'MM', color: '#c026d3' },
  { match: /(^|\/)yi(-|\/|$)|01-ai/i, label: 'Yi', color: '#059669' },
  { match: /nous|hermes/i, label: 'N', color: '#7c3aed' },
  { match: /(^|\/)ling(-|\/|$)|inclusionai/i, label: 'L', color: '#4f46e5' }
]

/** Dark enough for white lettering on top of any of them. */
const FALLBACK_COLORS = [
  '#475569',
  '#7c3aed',
  '#be185d',
  '#0e7490',
  '#b45309',
  '#b91c1c',
  '#047857',
  '#4338ca'
] as const

function hashOf(value: string): number {
  let hash = 0
  for (const char of value) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0
  return hash
}

/** Two letters from the model part, without the vendor prefix. */
function initialsOf(id: string): string {
  const bare = id.slice(id.lastIndexOf('/') + 1)
  const clean = bare.replace(/[^a-z0-9]/gi, '')
  return (clean.slice(0, 2) || bare.slice(0, 1) || '?').toUpperCase()
}

interface ModelIconProps {
  id: string
  className?: string
}

/**
 * A small brand tile for a model. Known families get the vendor's mark on its
 * colour; the rest get initials on a colour derived from the id, so every row
 * in a model list has an icon of its own.
 */
export function ModelIcon({ id, className }: ModelIconProps): JSX.Element {
  const family = FAMILIES.find((entry) => entry.match.test(id))
  const background = family?.color ?? FALLBACK_COLORS[hashOf(id) % FALLBACK_COLORS.length]

  return (
    <span
      aria-hidden
      style={{ backgroundColor: background }}
      className={cn(
        'inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] text-white shadow-xs ring-1 ring-black/10 dark:ring-white/15',
        className
      )}
    >
      {family?.logo ? (
        <ProviderLogo id={family.logo} className="size-2.5 text-white" />
      ) : (
        <span className="text-[7px] font-bold uppercase leading-none tracking-[-0.03em]">
          {family?.label ?? initialsOf(id)}
        </span>
      )}
    </span>
  )
}
