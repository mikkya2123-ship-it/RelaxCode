import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium outline-none transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'border border-input bg-card text-foreground hover:bg-accent active:bg-pressed',
        primary:
          'border border-transparent bg-primary text-primary-foreground hover:brightness-105 active:brightness-95',
        ghost:
          'border border-transparent bg-transparent text-foreground hover:bg-accent active:bg-pressed',
        muted: 'border border-transparent bg-secondary text-foreground hover:bg-accent active:bg-pressed',
        destructive:
          'border border-transparent bg-destructive text-destructive-foreground hover:brightness-95',
        link: 'border border-transparent text-foreground underline-offset-4 hover:underline'
      },
      size: {
        sm: 'h-8 rounded-md px-3 text-[13px]',
        default: 'h-9 px-4',
        lg: 'h-10 rounded-lg px-5',
        icon: 'size-9 rounded-md',
        'icon-sm': 'size-7 rounded-md',
        'icon-lg': 'size-10 rounded-lg'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }): React.JSX.Element {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
