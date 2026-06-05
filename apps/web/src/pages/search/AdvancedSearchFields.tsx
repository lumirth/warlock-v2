import type { InputHTMLAttributes } from 'react'
import {
  ANY_GENED_DISPLAY_LABEL,
  GENED_REQUIREMENT_GROUPS,
  GENED_DISPLAY_NAME,
  canonicalRequirementCodes,
  isSearchLevelFilter,
  isSearchStatusFilter,
  isSearchTermFilter,
  isSearchTimeFilter,
  requirementFilter,
  type RequirementFilterMode,
  type AdvancedSearchStateDto,
  type SearchRequestFilterKey,
  type SearchRequestFiltersDto,
  type SearchScope,
} from '@uiuc-course-search/query-types'
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ANY_SELECT_VALUE,
  DELIVERY_OPTIONS,
  LEVEL_OPTIONS,
  PART_OF_TERM_OPTIONS,
  STATUS_OPTIONS,
  TERM_OPTIONS,
  TIME_OPTIONS,
  WORKLOAD_OPTIONS,
  type SelectOption,
} from './search-options'

const REQUIREMENT_MATCH_OPTIONS = [
  { value: 'any', label: 'Any listed' },
  { value: 'all', label: 'All listed' },
] as const satisfies SelectOption[]

export function AdvancedSearchFields({
  advancedDraft,
  onAdvancedDraftFilterChange,
  onAdvancedDraftScopeChange,
}: {
  advancedDraft: AdvancedSearchStateDto
  onAdvancedDraftFilterChange: <Key extends SearchRequestFilterKey>(
    key: Key,
    value: SearchRequestFiltersDto[Key]
  ) => void
  onAdvancedDraftScopeChange: (value?: SearchScope) => void
}) {
  const filters = advancedDraft.filters
  return (
    <div className="flex flex-col gap-5">
      <FieldSet>
        <FieldLegend variant="label">Course</FieldLegend>
        <FieldGroup className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <AdvancedTextField
            id="advanced-subject"
            label="Subject"
            maxLength={8}
            placeholder="CS"
            value={filters.subject ?? ''}
            onChange={(value) =>
              onAdvancedDraftFilterChange('subject', value.toUpperCase() || undefined)
            }
          />
          <AdvancedTextField
            id="advanced-number"
            label="Course number"
            inputMode="numeric"
            maxLength={4}
            placeholder="225"
            value={filters.number ?? ''}
            onChange={(value) =>
              onAdvancedDraftFilterChange('number', value || undefined)
            }
          />
          <AdvancedTextField
            id="advanced-instructor"
            label="Instructor"
            placeholder="Fagen"
            value={filters.instructor ?? ''}
            onChange={(value) =>
              onAdvancedDraftFilterChange('instructor', value || undefined)
            }
          />
          <AdvancedSelectField
            id="advanced-requirement-mode"
            label={`${GENED_DISPLAY_NAME} match`}
            placeholder={ANY_GENED_DISPLAY_LABEL}
            value={requirementMatchMode(filters.requirement)}
            options={REQUIREMENT_MATCH_OPTIONS}
            onChange={(value) =>
              onAdvancedDraftFilterChange(
                'requirement',
                requirementFilterFromCodes(
                  filters.requirement?.codes ?? [],
                  value === 'all' ? 'all' : 'any'
                )
              )
            }
          />
          <AdvancedSelectField
            id="advanced-level"
            label="Level"
            placeholder="Any level"
            value={filters.level?.toString()}
            options={LEVEL_OPTIONS}
            onChange={(value) => {
              onAdvancedDraftFilterChange('level', levelFilterValue(value))
            }}
          />
        </FieldGroup>
        <RequirementOptionField
          value={filters.requirement}
          onChange={(value) => onAdvancedDraftFilterChange('requirement', value)}
        />
      </FieldSet>

      <FieldSet>
        <FieldLegend variant="label">Term and meeting</FieldLegend>
        <FieldGroup className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <AdvancedSelectField
            id="advanced-term"
            label="Term"
            placeholder="Any term"
            value={filters.term}
            options={TERM_OPTIONS}
            onChange={(value) =>
              onAdvancedDraftFilterChange('term', termFilterValue(value))
            }
          />
          <AdvancedTextField
            id="advanced-year"
            label="Year"
            inputMode="numeric"
            maxLength={4}
            placeholder="2026"
            value={filters.year?.toString() ?? ''}
            onChange={(value) => {
              const year = parseInt(value, 10)
              onAdvancedDraftFilterChange(
                'year',
                Number.isNaN(year) ? undefined : year
              )
            }}
          />
          <AdvancedTextField
            id="advanced-days"
            label="Days"
            maxLength={7}
            placeholder="MWF"
            value={filters.days ?? ''}
            onChange={(value) =>
              onAdvancedDraftFilterChange('days', value.toUpperCase() || undefined)
            }
          />
          <AdvancedSelectField
            id="advanced-time"
            label="Time"
            placeholder="Any time"
            value={filters.time}
            options={TIME_OPTIONS}
            onChange={(value) =>
              onAdvancedDraftFilterChange('time', timeFilterValue(value))
            }
          />
          <AdvancedSelectField
            id="advanced-part-of-term"
            label="Part of term"
            placeholder="Any part"
            value={filters.partOfTerm}
            options={PART_OF_TERM_OPTIONS}
            onChange={(value) => onAdvancedDraftFilterChange('partOfTerm', value)}
          />
        </FieldGroup>
        <AdvancedCheckboxField
          id="advanced-include-past"
          label="Include past terms"
          description="Add historical offerings to the result pool."
          checked={advancedDraft.scope === 'all'}
          onChange={(checked) =>
            onAdvancedDraftScopeChange(checked ? 'all' : undefined)
          }
        />
      </FieldSet>

      <FieldSet>
        <FieldLegend variant="label">Preferences</FieldLegend>
        <FieldGroup className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <AdvancedTextField
            id="advanced-credits"
            label="Credits"
            inputMode="numeric"
            maxLength={2}
            placeholder="3"
            value={filters.credits?.toString() ?? ''}
            onChange={(value) => {
              const credits = parseInt(value, 10)
              onAdvancedDraftFilterChange(
                'credits',
                Number.isNaN(credits) ? undefined : credits
              )
            }}
          />
          <AdvancedSelectField
            id="advanced-delivery"
            label="Delivery"
            placeholder="Any delivery"
            value={
              filters.online === undefined
                ? undefined
                : String(filters.online)
            }
            options={DELIVERY_OPTIONS}
            onChange={(value) =>
              onAdvancedDraftFilterChange(
                'online',
                value === undefined ? undefined : value === 'true'
              )
            }
          />
          <AdvancedSelectField
            id="advanced-status"
            label="Status"
            placeholder="Any status"
            value={filters.status}
            options={STATUS_OPTIONS}
            onChange={(value) =>
              onAdvancedDraftFilterChange('status', statusFilterValue(value))
            }
          />
          <AdvancedSelectField
            id="advanced-workload"
            label="Workload"
            placeholder="Any workload"
            value={filters.workload}
            options={WORKLOAD_OPTIONS}
            onChange={(value) =>
              onAdvancedDraftFilterChange(
                'workload',
                value === 'easy' || value === 'hard' ? value : undefined
              )
            }
          />
        </FieldGroup>
      </FieldSet>
    </div>
  )
}

function AdvancedTextField({
  id,
  label,
  value,
  placeholder,
  inputMode,
  maxLength,
  onChange,
}: {
  id: string
  label: string
  value: string
  placeholder: string
  inputMode?: InputHTMLAttributes<HTMLInputElement>['inputMode']
  maxLength?: number
  onChange: (value: string) => void
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        autoComplete="off"
        inputMode={inputMode}
        maxLength={maxLength}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </Field>
  )
}

function termFilterValue(
  value: string | undefined
): SearchRequestFiltersDto['term'] {
  return isSearchTermFilter(value) ? value : undefined
}

function timeFilterValue(
  value: string | undefined
): SearchRequestFiltersDto['time'] {
  return isSearchTimeFilter(value) ? value : undefined
}

function statusFilterValue(
  value: string | undefined
): SearchRequestFiltersDto['status'] {
  return isSearchStatusFilter(value) ? value : undefined
}

function levelFilterValue(
  value: string | undefined
): SearchRequestFiltersDto['level'] {
  const level = value ? parseInt(value, 10) : NaN
  return isSearchLevelFilter(level) ? level : undefined
}

function requirementMatchMode(
  requirement: SearchRequestFiltersDto['requirement']
): Extract<RequirementFilterMode, 'any' | 'all'> {
  return requirement?.mode === 'all' ? 'all' : 'any'
}

function requirementFilterFromCodes(
  values: readonly string[],
  mode: Extract<RequirementFilterMode, 'any' | 'all'>
): SearchRequestFiltersDto['requirement'] {
  const codes = canonicalRequirementCodes(values)
  if (codes.length === 0) return undefined
  return requirementFilter(codes.length === 1 ? 'single' : mode, codes)
}

function RequirementOptionField({
  value,
  onChange,
}: {
  value: SearchRequestFiltersDto['requirement']
  onChange: (value: SearchRequestFiltersDto['requirement']) => void
}) {
  const selectedCodes = new Set(canonicalRequirementCodes(value?.codes))
  const mode = requirementMatchMode(value)

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
    <Field className="rounded-md border bg-background px-3 py-3">
      <FieldLabel asChild>
        <span>{GENED_DISPLAY_NAME} categories</span>
      </FieldLabel>
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
      className="flex min-w-0 cursor-pointer items-start gap-2 rounded-sm px-1 py-0.5 text-sm leading-5 hover:bg-muted/60"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(code, event.currentTarget.checked)}
        className="mt-0.5 size-4 rounded-[var(--radius-sm)] border-border text-primary accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        <span className="text-muted-foreground text-xs">{code}</span>
      </span>
    </label>
  )
}

function AdvancedSelectField({
  id,
  label,
  placeholder,
  value,
  options,
  onChange,
}: {
  id: string
  label: string
  placeholder: string
  value?: string
  options: SelectOption[]
  onChange: (value: string | undefined) => void
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        value={value ?? ANY_SELECT_VALUE}
        onValueChange={(nextValue) =>
          onChange(nextValue === ANY_SELECT_VALUE ? undefined : nextValue)
        }
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value={ANY_SELECT_VALUE}>{placeholder}</SelectItem>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  )
}

function AdvancedCheckboxField({
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
    <Field className="rounded-md border bg-background px-3 py-2">
      <div className="flex items-start gap-2">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.currentTarget.checked)}
          className="mt-1 size-4 rounded-[var(--radius-sm)] border-border text-primary accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
