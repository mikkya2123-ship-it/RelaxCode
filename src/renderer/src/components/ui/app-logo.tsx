import type { JSX } from 'react'
import darkLogo from '@/assets/app-logo-dark.png'
import lightLogo from '@/assets/app-logo-light.png'
import mascot from '@/assets/app-mascot.svg'
import { cn } from '@/lib/utils'

interface AppLogoProps {
  className?: string
}

export function AppMascot({ className }: AppLogoProps): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block shrink-0 bg-foreground', className)}
      style={{
        WebkitMaskImage: `url(${mascot})`,
        WebkitMaskPosition: 'center',
        WebkitMaskRepeat: 'no-repeat',
        WebkitMaskSize: 'contain',
        maskImage: `url(${mascot})`,
        maskPosition: 'center',
        maskRepeat: 'no-repeat',
        maskSize: 'contain'
      }}
    />
  )
}

/**
 * The mark ships in two drawings: light strokes for the dark theme and dark
 * strokes for the light one. Both are rendered and `.dark` on <html> decides
 * which one is visible, so `system` follows the app theme too.
 */
export function AppLogo({ className }: AppLogoProps): JSX.Element {
  return (
    <>
      <img
        src={lightLogo}
        alt=""
        draggable={false}
        className={cn('select-none dark:hidden', className)}
      />
      <img
        src={darkLogo}
        alt=""
        draggable={false}
        className={cn('hidden select-none dark:block', className)}
      />
    </>
  )
}
