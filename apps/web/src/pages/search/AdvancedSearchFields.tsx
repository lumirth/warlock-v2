import {
  isSearchLevelFilter,
  isSearchStatusFilter,
  isSearchTimeFilter,
  type AdvancedSearchStateDto,
  type SearchRequestFilterKey,
  type SearchRequestFiltersDto,
  type SearchScope,
  type SearchTermOptionDto,
} from '@uiuc-course-search/query-types'
import { FieldGroup, FieldLegend, FieldSet } from '@/components/ui/field'
import {
  CREDIT_OPTIONS,
  DELIVERY_OPTIONS,
  LEVEL_OPTIONS,
  PART_OF_TERM_OPTIONS,
  STATUS_OPTIONS,
  TIME_OPTIONS,
  INSTRUCTOR_DIFFICULTY_OPTIONS,
  type SelectOption,
} from './search-options'
import {
  AdvancedCheckboxField,
  AdvancedSelectField,
  AdvancedTextField,
} from './AdvancedSearchControls'
import { RequirementPicker } from './RequirementPicker'
import type { AdvancedFilterErrors } from './search-filter-model'

export function AdvancedSearchFields({
  advancedDraft,
  availableTerms,
  termOptionsError,
  termOptionsLoading,
  errors,
  onRetryTermOptions,
  onAdvancedDraftFilterChange,
  onAdvancedDraftScopeChange,
}: {
  advancedDraft: AdvancedSearchStateDto
  availableTerms?: SearchTermOptionDto[]
  termOptionsError: boolean
  termOptionsLoading: boolean
  errors: AdvancedFilterErrors
  onRetryTermOptions: () => void
  onAdvancedDraftFilterChange: <Key extends SearchRequestFilterKey>(
    key: Key,
    value: SearchRequestFiltersDto[Key]
  ) => void
  onAdvancedDraftScopeChange: (value?: SearchScope) => void
}) {
  const filters = advancedDraft.filters
  const offeringOptions = getOfferingOptions(
    availableTerms,
    filters.term,
    filters.year
  )
  const selectedOffering = getSelectedOfferingValue(
    availableTerms,
    filters.term,
    filters.year
  )

  return (
    <div className="flex flex-col gap-5">
      <FieldSet>
        <FieldLegend variant="label">Course</FieldLegend>
        <FieldGroup className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <AdvancedTextField
            id="advanced-subject"
            label="Subject"
            maxLength={8}
            placeholder="e.g. CS"
            value={filters.subject ?? ''}
            error={errors.subject}
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
            error={errors.number}
            onChange={(value) =>
              onAdvancedDraftFilterChange('number', value || undefined)
            }
          />
          <AdvancedTextField
            id="advanced-instructor"
            label="Instructor"
            placeholder="e.g. Fagen"
            value={filters.instructor ?? ''}
            error={errors.instructor}
            onChange={(value) =>
              onAdvancedDraftFilterChange('instructor', value || undefined)
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
          onChange={(value) =>
            onAdvancedDraftFilterChange('requirement', value)
          }
        />
      </FieldSet>

      <FieldSet>
        <FieldLegend variant="label">Term and meeting</FieldLegend>
        <FieldGroup className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-2">
            <AdvancedSelectField
              id="advanced-offering"
              label="Offering"
              placeholder={
                termOptionsLoading
                  ? 'Loading offerings…'
                  : termOptionsError
                    ? 'Offerings unavailable'
                    : 'Any current offering'
              }
              value={selectedOffering}
              options={offeringOptions}
              disabled={termOptionsLoading || termOptionsError}
              description={
                termOptionsError
                  ? 'Term choices could not be loaded.'
                  : 'Choose a real catalog offering.'
              }
              onChange={(value) => {
                const offering = availableTerms?.find(
                  (candidate) => candidate.termId === value
                )
                onAdvancedDraftFilterChange('term', offering?.term)
                onAdvancedDraftFilterChange('year', offering?.year)
                if (offering?.status === 'historical') {
                  onAdvancedDraftScopeChange('all')
                }
              }}
            />
            {termOptionsError ? (
              <button
                type="button"
                className="text-primary min-h-8 w-fit text-xs font-medium underline underline-offset-4"
                onClick={onRetryTermOptions}
              >
                Retry offering list
              </button>
            ) : null}
          </div>
          <AdvancedTextField
            id="advanced-days"
            label="Days"
            maxLength={7}
            placeholder="e.g. MWF"
            value={filters.days ?? ''}
            error={errors.days}
            description="Use M T W R F S U; R means Thursday."
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
            onChange={(value) =>
              onAdvancedDraftFilterChange('partOfTerm', value)
            }
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
            label="Exact credits"
            placeholder="Any exact value"
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
              filters.online === undefined ? undefined : String(filters.online)
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
            id="advanced-instructor-difficulty"
            label="Instructor difficulty"
            placeholder="Any instructor difficulty"
            value={filters.instructorDifficulty}
            options={INSTRUCTOR_DIFFICULTY_OPTIONS}
            onChange={(value) =>
              onAdvancedDraftFilterChange(
                'instructorDifficulty',
                value === 'lower' || value === 'higher' ? value : undefined
              )
            }
          />
        </FieldGroup>
      </FieldSet>
    </div>
  )
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

function creditFilterValue(
  value: string | undefined
): SearchRequestFiltersDto['credits'] {
  const credits = value ? parseInt(value, 10) : NaN
  return Number.isNaN(credits) ? undefined : credits
}

function getOfferingOptions(
  availableTerms: SearchTermOptionDto[] | undefined,
  selectedTerm: SearchRequestFiltersDto['term'],
  selectedYear: number | undefined
): SelectOption[] {
  const options =
    availableTerms?.map((offering) => ({
      value: offering.termId,
      label: `${offering.label} · ${termStatusLabel(offering.status)}`,
    })) ?? []

  if (
    selectedTerm &&
    selectedYear &&
    !availableTerms?.some(
      (offering) =>
        offering.term === selectedTerm && offering.year === selectedYear
    )
  ) {
    options.unshift({
      value: `${selectedYear}-${selectedTerm}`,
      label: `${capitalize(selectedTerm)} ${selectedYear} · saved selection`,
    })
  }

  return options
}

function getSelectedOfferingValue(
  availableTerms: SearchTermOptionDto[] | undefined,
  selectedTerm: SearchRequestFiltersDto['term'],
  selectedYear: number | undefined
): string | undefined {
  if (!selectedTerm || !selectedYear) return undefined
  return (
    availableTerms?.find(
      (offering) =>
        offering.term === selectedTerm && offering.year === selectedYear
    )?.termId ?? `${selectedYear}-${selectedTerm}`
  )
}

function termStatusLabel(status: SearchTermOptionDto['status']): string {
  if (status === 'registrable') return 'registration open'
  if (status === 'active') return 'active'
  return 'historical'
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1).toLowerCase()}`
}
