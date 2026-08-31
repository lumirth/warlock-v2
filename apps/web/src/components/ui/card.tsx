import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn(
    'bg-card text-card-foreground flex flex-col gap-4 overflow-hidden rounded-xl py-4 text-sm ring-1 ring-foreground/10', className
  )} {...props} />
}
export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('grid gap-1 px-4', className)} {...props} />
}
export function CardTitle({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('text-base font-medium', className)} {...props} />
}
export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('px-4', className)} {...props} />
}
