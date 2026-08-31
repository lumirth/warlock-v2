import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

const variants = {
  default: 'bg-primary text-primary-foreground',
  secondary: 'bg-secondary text-secondary-foreground',
  destructive: 'bg-destructive/10 text-destructive',
  outline: 'border-border text-foreground',
  ghost: 'hover:bg-muted hover:text-muted-foreground',
  link: 'text-primary underline-offset-4 hover:underline',
} as const

export function Badge({ className, variant = 'default', ...props }:
  ComponentProps<'span'> & { variant?: keyof typeof variants }) {
  return <span className={cn(
    'inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 rounded-lg border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap',
    variants[variant], className
  )} {...props} />
}
