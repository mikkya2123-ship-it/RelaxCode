import { type JSX } from 'react'
import { cn } from '@/lib/utils'

/**
 * Plain brand glyphs for the known MCP companion apps, straight from the
 * Simple Icons set (official monochrome marks in their brand colours,
 * inlined into the bundle at build time — no network at runtime). No tile,
 * no frame: just the logo, like an emoji of the app. Adobe marks are not in
 * Simple Icons, so Ae/Pr/Ps render as plain coloured letterforms; unknown
 * servers show their initials.
 */

const modules = import.meta.glob('../../assets/mcp-logos/*.svg', {
  eager: true,
  query: '?raw',
  import: 'default'
}) as Record<string, string>

const LOGOS: Record<string, string> = {}
for (const [path, svg] of Object.entries(modules)) {
  LOGOS[path.slice(path.lastIndexOf('/') + 1).replace(/\.svg$/, '')] = svg
}

const APPS: Record<string, string> = {
  blender: 'blender',
  unity: 'unity',
  godot: 'godotengine',
  unreal: 'unrealengine',
  figma: 'figma',
  discord: 'discord',
  obsidian: 'obsidian',
  notion: 'notion',
  vscode: 'vscodium',
  chrome: 'googlechrome',
  telegram: 'telegram'
}

const LETTER_MARKS: Record<string, { text: string; color: string }> = {
  aftereffects: { text: 'Ae', color: '#9999FF' },
  premiere: { text: 'Pr', color: '#E0B3FF' },
  photoshop: { text: 'Ps', color: '#31A8FF' }
}

/** Normalises a server or app name to an app key: 'Blender MCP' → 'blender'. */
function appKey(name: string): string {
  const clean = name.toLowerCase().replace(/[^a-z0-9]/g, '')
  const aliases: Array<[RegExp, string]> = [
    [/aftereffects|^ae$/, 'aftereffects'],
    [/premiere|^pr$/, 'premiere'],
    [/photoshop|^ps$/, 'photoshop'],
    [/vscodium|vscode|visualstudiocode|^code$/, 'vscode'],
    [/unreal|^ue/, 'unreal'],
    [/godot/, 'godot'],
    [/telegram|^tg$/, 'telegram'],
    [/^chrome|googlechrome$/, 'chrome']
  ]
  for (const [pattern, key] of aliases) {
    if (pattern.test(clean)) return key
  }
  return clean
}

export function McpAppIcon({ name, className }: { name: string; className?: string }): JSX.Element {
  const key = appKey(name)

  // A known app: the plain official glyph in its brand colour.
  const slug = APPS[key]
  if (slug && LOGOS[slug]) {
    return (
      <span
        aria-hidden
        className={cn('inline-flex shrink-0 items-center justify-center [&>svg]:size-full', className)}
        dangerouslySetInnerHTML={{ __html: LOGOS[slug] }}
      />
    )
  }

  // Adobe marks: plain coloured letterforms, no frame.
  const letter = LETTER_MARKS[key]
  if (letter) {
    return (
      <span
        aria-hidden
        className={cn('inline-flex shrink-0 items-center justify-center font-extrabold leading-none', className)}
        style={{ color: letter.color }}
      >
        {letter.text}
      </span>
    )
  }

  // Unknown server: plain initials.
  const initials = (name.replace(/[^a-z0-9]/gi, '').slice(0, 2) || '?').toUpperCase()
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 items-center justify-center text-[0.9em] font-bold text-tertiary', className)}
    >
      {initials}
    </span>
  )
}
