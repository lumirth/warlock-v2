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
  CREDIT_OPTIONS, DELIVERY_OPTIONS, INSTRUCTOR_DIFFICULTY_OPTIONS, LEVEL_OPTIONS,
  PART_OF_TERM_OPTIONS, STATUS_OPTIONS, TIME_OPTIONS, type SelectOption,
} from './search-options'
import { AdvancedCheckboxField, AdvancedSelectField, AdvancedTextField } from './AdvancedSearchControls'
import { RequirementPicker } from './RequirementPicker'
import type { AdvancedFilterErrors } from './search-filter-model'

type Props = {
  advancedDraft: AdvancedSearchStateDto
  availableTerms?: SearchTermOptionDto[]
  termOptionsError: boolean
  termOptionsLoading: boolean
  errors: AdvancedFilterErrors
  onRetryTermOptions: () => void
  onAdvancedDraftFilterChange: <Key extends SearchRequestFilterKey>(key: Key, value: SearchRequestFiltersDto[Key]) => void
  onAdvancedDraftScopeChange: (value?: SearchScope) => void
}
type Change = Props['onAdvancedDraftFilterChange']

function Select({ change, keyName, label, placeholder, value, options, parse = (next) => next }: {
  change: Change
  keyName: SearchRequestFilterKey
  label: string
  placeholder: string
  value?: string
  options: SelectOption[]
  parse?: (value: string | undefined) => SearchRequestFiltersDto[SearchRequestFilterKey]
}) {
  return <AdvancedSelectField id={`advanced-${keyName}`} label={label} placeholder={placeholder}
    value={value} options={options} onChange={(next) => change(keyName, parse(next))} />
}

function offeringState(filters: SearchRequestFiltersDto, terms: SearchTermOptionDto[] = []) {
  const selected = filters.term && filters.year
    ? terms.find((item) => item.term === filters.term && item.year === filters.year)?.termId ?? `${filters.year}-${filters.term}`
    : undefined
  const options: SelectOption[] = terms.map((item) => ({
    value: item.termId,
    label: `${item.label} · ${item.status === 'registrable' ? 'registration open' : item.status}`,
  }))
  if (selected && !options.some(({ value }) => value === selected)) {
    options.unshift({ value: selected, label: `${filters.term} ${filters.year} · saved selection` })
  }
  return { selected, options }
}

function CourseFields({ advancedDraft: { filters }, errors, onAdvancedDraftFilterChange: change }: Props) {
  return <FieldSet>
    <FieldLegend>Course</FieldLegend>
    <FieldGroup className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <AdvancedTextField id="advanced-subject" label="Subject" maxLength={8} placeholder="e.g. CS" value={filters.subject ?? ''} error={errors.subject}
        onChange={(value) => change('subject', value.toUpperCase() || undefined)} />
      <AdvancedTextField id="advanced-number" label="Course number" inputMode="numeric" maxLength={4} placeholder="e.g. 225" value={filters.number ?? ''} error={errors.number}
        onChange={(value) => change('number', value || undefined)} />
      <AdvancedTextField id="advanced-instructor" label="Instructor" placeholder="e.g. Fagen" value={filters.instructor ?? ''} error={errors.instructor}
        onChange={(value) => change('instructor', value || undefined)} />
      <Select change={change} keyName="level" label="Level" placeholder="Any level" value={filters.level?.toString()} options={LEVEL_OPTIONS}
        parse={(value) => isSearchLevelFilter(Number(value)) ? Number(value) : undefined} />
    </FieldGroup>
    <RequirementPicker value={filters.requirement} onChange={(value) => change('requirement', value)} />
  </FieldSet>
}

function TermFields({ advancedDraft, availableTerms, termOptionsError, termOptionsLoading, errors,
  onRetryTermOptions, onAdvancedDraftFilterChange: change, onAdvancedDraftScopeChange: changeScope }: Props) {
  const { filters } = advancedDraft
  const offering = offeringState(filters, availableTerms)
  const placeholder = termOptionsLoading ? 'Loading offerings…' : termOptionsError ? 'Offerings unavailable' : 'Any current offering'
  return <FieldSet>
    <FieldLegend>Term and meeting</FieldLegend>
    <FieldGroup className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <AdvancedSelectField id="advanced-offering" label="Offering" placeholder={placeholder}
          value={offering.selected} options={offering.options} disabled={termOptionsLoading || termOptionsError}
          onChange={(value) => {
            const next = availableTerms?.find(({ termId }) => termId === value)
            change('term', next?.term)
            change('year', next?.year)
            if (next?.status === 'historical') changeScope('all')
          }} />
        {termOptionsError && <button type="button" className="text-primary mt-2 text-xs font-medium underline" onClick={onRetryTermOptions}>Retry offering list</button>}
      </div>
      <AdvancedTextField id="advanced-days" label="Days" maxLength={7} placeholder="e.g. MWF" value={filters.days ?? ''} error={errors.days} description="M T W R F S U; R is Thursday."
        onChange={(value) => change('days', value.toUpperCase() || undefined)} />
      <Select change={change} keyName="time" label="Time" placeholder="Any time" value={filters.time} options={TIME_OPTIONS}
        parse={(value) => isSearchTimeFilter(value) ? value : undefined} />
      <Select change={change} keyName="partOfTerm" label="Part of term" placeholder="Any part" value={filters.partOfTerm} options={PART_OF_TERM_OPTIONS} />
    </FieldGroup>
    <AdvancedCheckboxField id="advanced-include-past" label="Include past terms" description="Add historical offerings to the result pool."
      checked={advancedDraft.scope === 'all'} onChange={(checked) => changeScope(checked ? 'all' : undefined)} />
  </FieldSet>
}

function PreferenceFields({ advancedDraft: { filters }, onAdvancedDraftFilterChange: change }: Props) {
  return <FieldSet>
    <FieldLegend>Preferences</FieldLegend>
    <FieldGroup className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Select change={change} keyName="credits" label="Exact credits" placeholder="Any exact value" value={filters.credits?.toString()} options={CREDIT_OPTIONS}
        parse={(value) => value === undefined ? undefined : Number(value)} />
      <Select change={change} keyName="online" label="Delivery" placeholder="Any delivery" value={filters.online === undefined ? undefined : String(filters.online)} options={DELIVERY_OPTIONS}
        parse={(value) => value === undefined ? undefined : value === 'true'} />
      <Select change={change} keyName="status" label="Status" placeholder="Any status" value={filters.status} options={STATUS_OPTIONS}
        parse={(value) => isSearchStatusFilter(value) ? value : undefined} />
      <Select change={change} keyName="instructorDifficulty" label="Instructor difficulty" placeholder="Any instructor difficulty" value={filters.instructorDifficulty} options={INSTRUCTOR_DIFFICULTY_OPTIONS}
        parse={(value) => value === 'lower' || value === 'higher' ? value : undefined} />
    </FieldGroup>
  </FieldSet>
}

export function AdvancedSearchFields(props: Props) {
  return <div className="flex flex-col gap-5">
    <CourseFields {...props} /><TermFields {...props} /><PreferenceFields {...props} />
  </div>
}
