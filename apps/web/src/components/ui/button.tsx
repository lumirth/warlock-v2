import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

type Variant = 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive' | 'link'
type Size = 'default' | 'xs' | 'sm' | 'lg' | 'icon' | 'icon-xs' | 'icon-sm' | 'icon-lg'

const variants: Record<Variant, string> = {
  default: 'bg-primary text-primary-foreground hover:bg-primary-hover',
  outline: 'border-border bg-background hover:bg-muted aria-expanded:bg-muted',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-muted',
  ghost: 'hover:bg-muted hover:text-foreground aria-expanded:bg-muted',
  destructive: 'bg-destructive/10 text-destructive hover:bg-destructive/20',
  link: 'text-primary underline-offset-4 hover:underline',
}
const sizes: Record<Size, string> = {
  default: 'h-8 gap-1.5 px-2.5',
  xs: 'h-8 gap-1 px-2 text-xs [&_svg]:size-3',
  sm: 'h-8 gap-1 px-2.5 text-xs [&_svg]:size-3.5',
  lg: 'h-9 gap-1.5 px-2.5',
  icon: 'size-8',
  'icon-xs': 'size-8 [&_svg]:size-3',
  'icon-sm': 'size-8',
  'icon-lg': 'size-9',
}

export function buttonVariants({ variant = 'default', size = 'default', className }: {
  variant?: Variant
  size?: Size
  className?: string
} = {}) {
  return cn(
    'inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:size-4',
    variants[variant], sizes[size], className
  )
}

export function Button({ className, variant, size, type = 'button', ...props }:
  ComponentProps<'button'> & { variant?: Variant; size?: Size }) {
  return <button type={type} className={buttonVariants({ variant, size, className })} {...props} />
}
