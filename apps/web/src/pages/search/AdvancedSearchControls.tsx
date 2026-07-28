import { useId, type InputHTMLAttributes } from 'react'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ANY_SELECT_VALUE, type SelectOption } from './search-options'

export function AdvancedTextField({
  id,
  label,
  value,
  placeholder,
  inputMode,
  maxLength,
  error,
  description,
  onChange,
}: {
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
  const inputId = useId()
  const descriptionId = `${inputId}-description`

  return (
    <Field>
      <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
      <Input
        type="search"
        id={inputId}
        data-search-filter-field={id}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        inputMode={inputMode}
        maxLength={maxLength}
        placeholder={placeholder}
        value={value}
        aria-invalid={Boolean(error)}
        aria-describedby={error || description ? descriptionId : undefined}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {error || description ? (
        <p
          id={descriptionId}
          className={
            error
              ? 'text-destructive text-xs leading-5'
              : 'text-muted-foreground text-xs leading-5'
          }
        >
          {error ?? description}
        </p>
      ) : null}
    </Field>
  )
}

export function AdvancedSelectField({
  id,
  label,
  placeholder,
  value,
  options,
  disabled = false,
  description,
  onChange,
}: {
  id: string
  label: string
  placeholder: string
  value?: string
  options: SelectOption[]
  disabled?: boolean
  description?: string
  onChange: (value: string | undefined) => void
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <select
        id={id}
        data-search-filter-field={id}
        className="border-input focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full min-w-0 rounded-lg border bg-transparent px-2.5 py-1 text-sm transition-colors outline-none focus-visible:ring-3 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
        value={value ?? ANY_SELECT_VALUE}
        disabled={disabled}
        onChange={(event) =>
          onChange(
            event.currentTarget.value === ANY_SELECT_VALUE
              ? undefined
              : event.currentTarget.value
          )
        }
      >
        <option value={ANY_SELECT_VALUE}>{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {description ? (
        <p className="text-muted-foreground text-xs leading-5">{description}</p>
      ) : null}
    </Field>
  )
}

export function AdvancedCheckboxField({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <Field className="bg-background rounded-md border px-3 py-2.5">
      <div className="flex items-start gap-2">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.currentTarget.checked)}
          className="border-border text-primary accent-primary focus-visible:ring-ring focus-visible:ring-offset-background mt-0.5 size-5 rounded-[var(--radius-sm)] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <p className="text-muted-foreground text-xs leading-5">
            {description}
          </p>
        </div>
      </div>
    </Field>
  )
}
