import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState, type JSX } from 'react'
import { cn } from '@/lib/utils'

/**
 * AI Text Loading — the shimmering label from Kokonut UI (MIT, kokonutui.com),
 * adapted to this app: the gradient uses the theme's text colours instead of
 * fixed neutrals, so it reads in both themes, and the demo's `p-8` wrapper is
 * gone so it can sit inline in the chat.
 *
 * The point is motion while the agent works: the phrase switches with a short
 * flip and a highlight travels across the text, so a wait never looks frozen.
 */

interface AITextLoadingProps {
  texts?: string[]
  className?: string
  interval?: number
}

export function AITextLoading({
  texts = ['Thinking...', 'Processing...', 'Analyzing...', 'Computing...', 'Almost...'],
  className,
  interval = 1500
}: AITextLoadingProps): JSX.Element {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), interval)
    return () => clearInterval(timer)
  }, [interval])

  // The modulo makes a changing list safe: one phrase (while a tool runs) just
  // stops switching, and the highlight keeps travelling.
  const count = Math.max(1, texts.length)
  const index = tick % count

  return (
    <div className="flex items-center">
      <AnimatePresence mode="wait">
        <motion.span
          key={index}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0, backgroundPosition: ['200% center', '-200% center'] }}
          exit={{ opacity: 0, y: -8 }}
          transition={{
            opacity: { duration: 0.3 },
            y: { duration: 0.3 },
            backgroundPosition: { duration: 2.5, ease: 'linear', repeat: Number.POSITIVE_INFINITY }
          }}
          className={cn(
            'inline-block whitespace-nowrap bg-[length:200%_100%] bg-linear-to-r from-foreground via-muted-foreground to-foreground bg-clip-text font-semibold text-transparent',
            className
          )}
        >
          {texts[index] ?? ''}
        </motion.span>
      </AnimatePresence>
    </div>
  )
}

export default AITextLoading
