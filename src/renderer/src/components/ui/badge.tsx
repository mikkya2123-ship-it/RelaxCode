import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium transition-colors [&_svg]:pointer-events-none [&_svg:not([class*=size-])]:size-3',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-secondary text-muted-foreground',
        outline: 'border-border bg-transparent text-muted-foreground',
        success: 'border-transparent bg-success/10 text-success'
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
)

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>): React.JSX.Element {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
