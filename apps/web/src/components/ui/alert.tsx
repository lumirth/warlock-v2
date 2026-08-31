import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Alert({ className, variant = 'default', ...props }:
  ComponentProps<'div'> & { variant?: 'default' | 'destructive' }) {
  return <div role="alert" className={cn(
    'relative grid w-full gap-0.5 rounded-lg border px-2.5 py-2 text-left text-sm has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 [&>svg]:row-span-2 [&>svg]:size-4',
    variant === 'destructive' ? 'bg-card text-destructive' : 'bg-card text-card-foreground', className
  )} {...props} />
}
export function AlertTitle({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('font-medium', className)} {...props} />
}
export function AlertDescription({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('text-muted-foreground col-start-2 text-sm', className)} {...props} />
}
