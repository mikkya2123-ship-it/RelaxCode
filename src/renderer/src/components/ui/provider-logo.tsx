import { type JSX } from 'react'
import { cn } from '@/lib/utils'

/**
 * Every provider in the bundled catalogue ships its real mark. The files are
 * inlined at build time: most are drawn with `currentColor`, so they take the
 * colour of the row they sit in and need no extra request.
 */
const modules = import.meta.glob('../../assets/provider-logos/*.svg', {
  eager: true,
  query: '?raw',
  import: 'default'
}) as Record<string, string>

const LOGOS: Record<string, string> = {}
for (const [path, svg] of Object.entries(modules)) {
  LOGOS[path.slice(path.lastIndexOf('/') + 1).replace(/\.svg$/, '')] = svg
}

/** Logos with hardcoded colours are dark drawings and have to be flipped. */
const FLIPPED = new Set(
  Object.entries(LOGOS)
    .filter(([, svg]) => !svg.includes('currentColor'))
    .map(([id]) => id)
)

export function hasProviderLogo(id: string): boolean {
  return id in LOGOS
}

interface ProviderLogoProps {
  id: string
  className?: string
}

/** The provider's mark, or a plain tile with its initials when none is known. */
export function ProviderLogo({ id, className }: ProviderLogoProps): JSX.Element {
  const svg = LOGOS[id]

  if (!svg) {
    return (
      <span
        aria-hidden
        className={cn(
          'inline-flex size-5 shrink-0 items-center justify-center rounded-[5px] border border-border text-[9px] font-semibold uppercase text-tertiary',
          className
        )}
      >
        {id.replace(/[^a-z0-9]/gi, '').slice(0, 2)}
      </span>
    )
  }

  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-5 shrink-0 items-center justify-center [&>svg]:size-full',
        FLIPPED.has(id) && 'dark:invert',
        className
      )}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
