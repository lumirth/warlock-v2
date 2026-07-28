import { useState } from 'react'
import { ChevronDownIcon } from 'lucide-react'
import {
  canonicalRequirementCodes,
  GENED_DISPLAY_NAME,
  GENED_REQUIREMENT_GROUPS,
  requirementFilter,
  type RequirementFilterMode,
  type SearchRequestFiltersDto,
} from '@uiuc-course-search/query-types'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import { Field, FieldLabel } from '@/components/ui/field'

export function requirementMatchMode(
  requirement: SearchRequestFiltersDto['requirement']
): Extract<RequirementFilterMode, 'any' | 'all'> {
  return requirement?.mode === 'all' ? 'all' : 'any'
}

export function requirementFilterFromCodes(
  values: readonly string[],
  mode: Extract<RequirementFilterMode, 'any' | 'all'>
): SearchRequestFiltersDto['requirement'] {
  const codes = canonicalRequirementCodes(values)
  if (codes.length === 0) return undefined
  return requirementFilter(codes.length === 1 ? 'single' : mode, codes)
}

export function RequirementPicker({
  value,
  onChange,
}: {
  value: SearchRequestFiltersDto['requirement']
  onChange: (value: SearchRequestFiltersDto['requirement']) => void
}) {
  const [open, setOpen] = useState(false)
  const selectedCodes = new Set(canonicalRequirementCodes(value?.codes))
  const mode = requirementMatchMode(value)
  const selectedSummary = [...selectedCodes].sort().join(', ')

  const toggleCode = (code: string, checked: boolean) => {
    const nextCodes = new Set(selectedCodes)
    if (checked) {
      nextCodes.add(code)
    } else {
      nextCodes.delete(code)
    }
    onChange(requirementFilterFromCodes([...nextCodes], mode))
  }

  return (
    <Field className="bg-background rounded-md border px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <FieldLabel asChild>
            <span>{GENED_DISPLAY_NAME} categories</span>
          </FieldLabel>
          <p className="text-muted-foreground mt-1 text-xs">
            {selectedSummary
              ? `${selectedCodes.size} selected: ${selectedSummary}`
              : 'No GenEd filter selected'}
          </p>
        </div>
        <Button
          type="button"
          size="xs"
          variant="outline"
          aria-expanded={open}
          aria-controls="advanced-requirement-options"
          onClick={() => setOpen((nextOpen) => !nextOpen)}
        >
          Choose GenEds
          <ChevronDownIcon
            aria-hidden
            className={
              open ? 'rotate-180 transition-transform' : 'transition-transform'
            }
          />
        </Button>
      </div>
      <Collapsible open={open}>
        <CollapsibleContent id="advanced-requirement-options">
          {selectedCodes.size > 1 ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-b pb-3">
              <FieldLabel htmlFor="advanced-requirement-mode">Match</FieldLabel>
              <select
                id="advanced-requirement-mode"
                className="border-input focus-visible:border-ring focus-visible:ring-ring/50 h-8 rounded-lg border bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3"
                value={mode}
                onChange={(event) =>
                  onChange(
                    requirementFilterFromCodes(
                      [...selectedCodes],
                      event.currentTarget.value === 'all' ? 'all' : 'any'
                    )
                  )
                }
              >
                <option value="any">Any selected category</option>
                <option value="all">Every selected category</option>
              </select>
            </div>
          ) : null}
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {GENED_REQUIREMENT_GROUPS.map((group) => (
              <div key={group.code} className="flex min-w-0 flex-col gap-2">
                <RequirementOptionCheckbox
                  code={group.code}
                  label={group.label}
                  checked={selectedCodes.has(group.code)}
                  onChange={toggleCode}
                />
                {group.options.length > 0 ? (
                  <div className="ml-6 flex flex-col gap-1.5 border-l pl-3">
                    {group.options.map((option) => (
                      <RequirementOptionCheckbox
                        key={option.code}
                        code={option.code}
                        label={option.label}
                        checked={selectedCodes.has(option.code)}
                        onChange={toggleCode}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Field>
  )
}

function RequirementOptionCheckbox({
  code,
  label,
  checked,
  onChange,
}: {
  code: string
  label: string
  checked: boolean
  onChange: (code: string, checked: boolean) => void
}) {
  const id = `advanced-requirement-${code.toLowerCase()}`
  return (
    <label
      htmlFor={id}
      className="hover:bg-muted/60 flex min-h-8 min-w-0 cursor-pointer items-start gap-2 rounded-sm px-1 py-1.5 text-sm leading-5"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(code, event.currentTarget.checked)}
        className="border-border text-primary accent-primary focus-visible:ring-ring focus-visible:ring-offset-background size-5 rounded-[var(--radius-sm)] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        <span className="text-muted-foreground text-xs">{code}</span>
      </span>
    </label>
  )
}
