import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Table({ className, scrollAreaLabel = 'Scrollable table', ...props }:
  ComponentProps<'table'> & { scrollAreaLabel?: string }) {
  return <div role="region" aria-label={scrollAreaLabel} tabIndex={0} className="w-full overflow-x-auto">
    <table className={cn('w-full text-sm', className)} {...props} />
  </div>
}
export function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return <thead className={cn('[&_tr]:border-b', className)} {...props} />
}
export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />
}
export function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return <tr className={cn('hover:bg-muted/50 border-b', className)} {...props} />
}
export function TableHead({ className, ...props }: ComponentProps<'th'>) {
  return <th className={cn('h-10 px-2 text-left font-medium whitespace-nowrap', className)} {...props} />
}
export function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return <td className={cn('p-2 align-middle whitespace-nowrap', className)} {...props} />
}
