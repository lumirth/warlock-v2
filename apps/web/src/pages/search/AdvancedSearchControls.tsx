import type { InputHTMLAttributes, ReactNode } from 'react'
import { Field, FieldLabel } from '@/components/ui/field'
import { ANY_SELECT_VALUE, type SelectOption } from './search-options'

const control = 'border-input focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3 disabled:opacity-50'

function Shell({ id, label, note, error, children }: {
  id: string
  label: string
  note?: string
  error?: string
  children: ReactNode
}) {
  return <Field>
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    {children}
    {(error || note) && <p id={`${id}-note`} className={`${error ? 'text-destructive' : 'text-muted-foreground'} text-xs leading-5`}>{error ?? note}</p>}
  </Field>
}

export function AdvancedTextField({ id, label, value, placeholder, inputMode, maxLength, error, description, onChange }: {
  id: string
  label: string
  value: string
  placeholder: string
  inputMode?: InputHTMLAttributes<HTMLInputElement>['inputMode']
  maxLength?: number
  error?: string
  description?: string
  onChange: (value: string) => void
}) {
  return <Shell id={id} label={label} error={error} note={description}>
    <input
      id={id}
      className={control}
      type="search"
      autoComplete="off"
      spellCheck={false}
      inputMode={inputMode}
      maxLength={maxLength}
      placeholder={placeholder}
      value={value}
      aria-invalid={Boolean(error)}
      aria-describedby={error || description ? `${id}-note` : undefined}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  </Shell>
}

export function AdvancedSelectField({ id, label, placeholder, value, options, disabled, description, onChange }: {
  id: string
  label: string
  placeholder: string
  value?: string
  options: SelectOption[]
  disabled?: boolean
  description?: string
  onChange: (value: string | undefined) => void
}) {
  return <Shell id={id} label={label} note={description}>
    <select id={id} className={control} value={value ?? ANY_SELECT_VALUE} disabled={disabled}
      onChange={(event) => onChange(event.currentTarget.value === ANY_SELECT_VALUE ? undefined : event.currentTarget.value)}>
      <option value={ANY_SELECT_VALUE}>{placeholder}</option>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </Shell>
}

export function AdvancedCheckboxField({ id, label, description, checked, onChange }: {
  id: string
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return <label htmlFor={id} className="bg-background flex items-start gap-2 rounded-md border px-3 py-2.5">
    <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} className="accent-primary mt-0.5 size-5" />
    <span><strong className="block text-sm font-medium">{label}</strong><span className="text-muted-foreground text-xs">{description}</span></span>
  </label>
}
