import { type JSX } from 'react'
import { cn } from '@/lib/utils'

/**
 * The official Craft app icons, copied unmodified from ArtCraft Launcher's
 * `assets/app-icons/` (each app's own icon, licensed like that app: MIT OR
 * Apache-2.0). No network at runtime: Vite inlines the URLs at build time.
 */
const modules = import.meta.glob('../../assets/artcraft/*.png', {
  eager: true,
  import: 'default'
}) as Record<string, string>

const ICONS: Record<string, string> = {}
for (const [path, url] of Object.entries(modules)) {
  ICONS[path.slice(path.lastIndexOf('/') + 1).replace(/\.png$/, '')] = url
}

export function ArtCraftAppIcon({
  app,
  className
}: {
  app: string
  className?: string
}): JSX.Element {
  const src = ICONS[app]
  if (!src) {
    return (
      <span
        aria-hidden
        className={cn('inline-flex shrink-0 items-center justify-center rounded-[6px] bg-muted text-[9px] font-bold text-muted-foreground', className)}
      >
        {app.slice(0, 2).toUpperCase()}
      </span>
    )
  }
  return (
    <img
      src={src}
      alt=""
      aria-hidden
      draggable={false}
      className={cn('shrink-0 rounded-[6px] object-contain', className)}
    />
  )
}
