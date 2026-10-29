import * as React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { cn } from '@/lib/utils'

/**
 * A sheet anchored to a small button. Unlike a dropdown it holds controls the
 * user keeps touching — a slider, a switch — so it stays open while they are
 * used and closes on Escape, on a click outside or on the trigger.
 */
function Popover(props: React.ComponentProps<typeof PopoverPrimitive.Root>): React.JSX.Element {
  return <PopoverPrimitive.Root {...props} />
}

function PopoverTrigger(
  props: React.ComponentProps<typeof PopoverPrimitive.Trigger>
): React.JSX.Element {
  return <PopoverPrimitive.Trigger {...props} />
}

function PopoverContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>): React.JSX.Element {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        sideOffset={sideOffset}
        className={cn(
          'z-50 max-h-[var(--radix-popover-content-available-height)] overflow-y-auto overflow-x-hidden rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-pop animate-pop-in outline-none',
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

export { Popover, PopoverTrigger, PopoverContent }
