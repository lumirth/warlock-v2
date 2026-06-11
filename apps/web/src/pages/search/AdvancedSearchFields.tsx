import {
  ANY_GENED_DISPLAY_LABEL,
  GENED_DISPLAY_NAME,
  isSearchLevelFilter,
  isSearchStatusFilter,
  isSearchTermFilter,
  isSearchTimeFilter,
  type AdvancedSearchStateDto,
  type SearchRequestFilterKey,
  type SearchRequestFiltersDto,
  type SearchScope,
} from '@uiuc-course-search/query-types'
import {
  FieldGroup,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import {
  CREDIT_OPTIONS,
  DELIVERY_OPTIONS,
  LEVEL_OPTIONS,
  PART_OF_TERM_OPTIONS,
  STATUS_OPTIONS,
  TERM_OPTIONS,
  TIME_OPTIONS,
  WORKLOAD_OPTIONS,
  type SelectOption,
} from './search-options'
import {
  AdvancedCheckboxField,
  AdvancedSelectField,
  AdvancedTextField,
} from './AdvancedSearchControls'
import {
  REQUIREMENT_MATCH_OPTIONS,
  RequirementPicker,
  requirementFilterFromCodes,
  requirementMatchMode,
} from './RequirementPicker'

export function AdvancedSearchFields({
  advancedDraft,
  availableYears,
  availableYearsError,
  onAdvancedDraftFilterChange,
  onAdvancedDraftScopeChange,
}: {
  advancedDraft: AdvancedSearchStateDto
  availableYears?: number[]
  availableYearsError: boolean
  onAdvancedDraftFilterChange: <Key extends SearchRequestFilterKey>(
    key: Key,
    value: SearchRequestFiltersDto[Key]
  ) => void
  onAdvancedDraftScopeChange: (value?: SearchScope) => void
}) {
  const filters = advancedDraft.filters
  const yearOptions = getYearOptions(availableYears, filters.year)

  return (
    <div className="flex flex-col gap-5">
      <FieldSet>
        <FieldLegend variant="label">Course</FieldLegend>
        <FieldGroup className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <AdvancedTextField
            id="advanced-subject"
            label="Subject"
            maxLength={8}
            placeholder="e.g. CS"
            value={filters.subject ?? ''}
            onChange={(value) =>
              onAdvancedDraftFilterChange(
                'subject',
                value.toUpperCase() || undefined
              )
            }
          />
          <AdvancedTextField
            id="advanced-number"
            label="Course number"
            inputMode="numeric"
            maxLength={4}
            placeholder="e.g. 225"
            value={filters.number ?? ''}
            onChange={(value) =>
              onAdvancedDraftFilterChange('number', value || undefined)
            }
          />
          <AdvancedTextField
            id="advanced-instructor"
            label="Instructor"
            placeholder="e.g. Fagen"
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
        <RequirementPicker
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
          <AdvancedSelectField
            id="advanced-year"
            label="Year"
            placeholder={availableYearsError ? 'Years unavailable' : 'Any year'}
            value={filters.year?.toString()}
            options={yearOptions}
            disabled={availableYearsError}
            description={
              availableYearsError
                ? 'Available years could not be loaded. Try again after the API is reachable.'
                : undefined
            }
            onChange={(value) =>
              onAdvancedDraftFilterChange('year', yearFilterValue(value))
            }
          />
          <AdvancedTextField
            id="advanced-days"
            label="Days"
            maxLength={7}
            placeholder="e.g. MWF"
            value={filters.days ?? ''}
            onChange={(value) =>
              onAdvancedDraftFilterChange(
                'days',
                value.toUpperCase() || undefined
              )
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
          <AdvancedSelectField
            id="advanced-credits"
            label="Credits"
            placeholder="Any credits"
            value={filters.credits?.toString()}
            options={CREDIT_OPTIONS}
            onChange={(value) =>
              onAdvancedDraftFilterChange('credits', creditFilterValue(value))
            }
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

function yearFilterValue(
  value: string | undefined
): SearchRequestFiltersDto['year'] {
  const year = value ? parseInt(value, 10) : NaN
  return Number.isNaN(year) ? undefined : year
}

function creditFilterValue(
  value: string | undefined
): SearchRequestFiltersDto['credits'] {
  const credits = value ? parseInt(value, 10) : NaN
  return Number.isNaN(credits) ? undefined : credits
}

function getYearOptions(
  availableYears: number[] | undefined,
  selectedYear: number | undefined
): SelectOption[] {
  const years = new Set(availableYears ?? [])
  if (typeof selectedYear === 'number') years.add(selectedYear)
  return [...years]
    .sort((left, right) => right - left)
    .map((year) => ({ value: String(year), label: String(year) }))
}
