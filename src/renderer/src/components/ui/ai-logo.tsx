import { type JSX } from 'react'
import { cn } from '@/lib/utils'

/**
 * Plain brand SVGs of the AI companies (OpenAI, Anthropic, Google, Meta,
 * Grok, DeepSeek, Mistral, Moonshot, MiniMax, Inception, NVIDIA) — inlined
 * from the bundled assets at build time, no network at runtime. No tile, no
 * frame: just the logo, sized like a piece of text. Returns nothing when the
 * name does not match a known company, so callers can stack it freely.
 */

const modules = import.meta.glob('../../assets/ai-logos/*.svg', {
  eager: true,
  query: '?raw',
  import: 'default'
}) as Record<string, string>

const LOGOS: Record<string, string> = {}
for (const [path, svg] of Object.entries(modules)) {
  LOGOS[path.slice(path.lastIndexOf('/') + 1).replace(/\.svg$/, '').replace(/-color$/, '')] = svg
}

const MATCHERS: Array<[RegExp, string]> = [
  [/anthropic|claude/, 'anthropic'],
  [/openai|chatgpt|^gpt|^o[134](-|$)/, 'openai'],
  [/google|gemini|gemma/, 'google'],
  [/meta|llama/, 'meta'],
  [/grok|^xai/, 'grok'],
  [/deepseek/, 'deepseek'],
  [/mistral|mixtral|codestral/, 'mistral'],
  [/moonshot|kimi/, 'moonshot'],
  [/minimax/, 'minimax'],
  [/inception|mercury/, 'inception'],
  [/nvidia/, 'nvidia']
]

export function aiCompanyOf(name: string): string | null {
  const clean = name.toLowerCase()
  for (const [pattern, key] of MATCHERS) {
    if (pattern.test(clean)) return key
  }
  return null
}

interface AiLogoProps {
  name: string
  /** The logo's box in pixels; defaults to the surrounding text size. */
  size?: number
  className?: string
}

export function AiLogo({ name, size, className }: AiLogoProps): JSX.Element | null {
  const company = aiCompanyOf(name)
  const svg = company ? LOGOS[company] : null
  if (!svg) return null
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 items-center justify-center [&>svg]:h-[1em] [&>svg]:w-auto', className)}
      style={{ fontSize: size ? `${size}px` : undefined }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
