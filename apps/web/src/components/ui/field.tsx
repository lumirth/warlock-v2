import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function FieldSet({ className, ...props }: ComponentProps<'fieldset'>) {
  return <fieldset className={cn('flex flex-col gap-4', className)} {...props} />
}
export function FieldLegend({ className, variant: _variant, ...props }:
  ComponentProps<'legend'> & { variant?: 'legend' | 'label' }) {
  return <legend className={cn('mb-1.5 text-sm font-medium', className)} {...props} />
}
export function FieldGroup({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex w-full flex-col gap-5', className)} {...props} />
}
export function Field({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex w-full flex-col gap-2', className)} {...props} />
}
export function FieldLabel({ className, ...props }: ComponentProps<'label'>) {
  return <label className={cn('w-fit text-sm font-medium', className)} {...props} />
}
