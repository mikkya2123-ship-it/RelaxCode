import * as React from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { cn } from '@/lib/utils'

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>): React.JSX.Element {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        // The on/off pair must stay readable in both themes: in dark, primary
        // is near-white, so the checked track flips to light and the knob to
        // dark instead of a white knob dissolving into a white track.
        'peer inline-flex h-[20px] w-[34px] shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-[#d4d4d8] transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-[#3a3a42] data-[state=checked]:bg-primary dark:data-[state=checked]:bg-primary',
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 rounded-full bg-white shadow-xs transition-transform duration-150 ease-out dark:data-[state=checked]:bg-[#1a1a1d] data-[state=checked]:translate-x-[15px] data-[state=unchecked]:translate-x-[1px]"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
