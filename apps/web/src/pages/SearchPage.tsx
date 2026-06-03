import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type InputHTMLAttributes,
} from 'react'
import {
  AlertCircleIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  LayoutGridIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  Table2Icon,
  XIcon,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api-client'
import { FeedbackButton } from '../components/FeedbackButton'
import {
  DEFAULT_SEARCH_SORT,
  SEARCH_SORT_DEFAULT_DIRECTIONS,
  getWorkloadTierLabel,
  type AdvancedSearchStateDto,
  type CourseDto,
  type CourseGenedDto,
  type MatchEvidence,
  type SearchAmbiguityActionDto,
  type SearchChipDto,
  type SearchFilters,
  type SearchMetaDto,
  type SearchResponseDto,
  type SearchSort,
  type SortDirection,
  type SortField,
} from '@uiuc-course-search/query-types'
import { getQualityLabel, getQualityTone } from '../utils/grading'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { PageContainer } from '@/components/PageContainer'
import { cn } from '@/lib/utils'

const SEARCH_PAGE_SIZE = 20
const ANY_SELECT_VALUE = '__any__'
const RESULT_VIEW_STORAGE_KEY = 'uiuc-course-search.result-view'

type SearchPagination = SearchResponseDto['pagination']
type SearchOptions = {
  offset?: number
  append?: boolean
  syncInput?: boolean
  filters?: AdvancedSearchStateDto
  sort?: SearchSort
  preserveResults?: boolean
}
type Tone = 'success' | 'warning' | 'destructive' | 'muted'
type ResultViewMode = 'cards' | 'table'
type CourseResultMetric = {
  label: string
  value: string
  tone?: Tone
  title?: string
}
type SelectOption = {
  value: string
  label: string
}
type SortFieldOption = SelectOption & {
  value: SortField
}
type TableSortColumn = {
  field: Exclude<SortField, 'relevance'>
  label: string
  className?: string
}

const ADVANCED_SEARCH_KEYS: (keyof AdvancedSearchStateDto)[] = [
  'subject',
  'number',
  'instructor',
  'term',
  'year',
  'gened',
  'credits',
  'days',
  'time',
  'partOfTerm',
  'online',
  'status',
  'difficulty',
  'level',
  'scope',
]

const ADVANCED_CONTRADICTION_KEYS = ADVANCED_SEARCH_KEYS.filter(
  (key) => key !== 'scope'
)

const TERM_OPTIONS: SelectOption[] = [
  { value: 'spring', label: 'Spring' },
  { value: 'summer', label: 'Summer' },
  { value: 'fall', label: 'Fall' },
  { value: 'winter', label: 'Winter' },
]

const TIME_OPTIONS: SelectOption[] = [
  { value: 'morning', label: 'Morning' },
  { value: 'afternoon', label: 'Afternoon' },
  { value: 'evening', label: 'Evening' },
]

const PART_OF_TERM_OPTIONS: SelectOption[] = [
  { value: '1', label: 'Full term' },
  { value: 'A', label: 'First half' },
  { value: 'B', label: 'Second half' },
]

const DELIVERY_OPTIONS: SelectOption[] = [
  { value: 'true', label: 'Online' },
  { value: 'false', label: 'In person' },
]

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
]

const WORKLOAD_OPTIONS: SelectOption[] = [
  { value: 'easy', label: 'Easier' },
  { value: 'hard', label: 'Harder' },
]

const LEVEL_OPTIONS: SelectOption[] = [
  { value: '100', label: '100 level' },
  { value: '200', label: '200 level' },
  { value: '300', label: '300 level' },
  { value: '400', label: '400 level' },
  { value: '500', label: '500+ level' },
]

const SORT_FIELD_OPTIONS: SortFieldOption[] = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'gpa', label: 'Avg GPA' },
  { value: 'quality', label: 'Quality' },
  { value: 'workload', label: 'Workload' },
  { value: 'instructor_rating', label: 'Instructor rating' },
  { value: 'level', label: 'Level' },
  { value: 'credits', label: 'Credits' },
]

const TABLE_SORT_COLUMNS: TableSortColumn[] = [
  { field: 'quality', label: 'Quality' },
  { field: 'workload', label: 'Workload' },
  { field: 'gpa', label: 'Avg GPA' },
  { field: 'instructor_rating', label: 'Instructor rating' },
  { field: 'level', label: 'Level' },
  { field: 'credits', label: 'Credits' },
]
const FIRST_RUN_EXAMPLE_QUERIES = [
  'CS 225',
  'easy cs gened',
  'data structures with fagen',
  'online stats class',
  '4 credit hum no friday classes',
]

const WEAK_RESIDUAL_TERMS = new Set([
  'a',
  'an',
  'and',
  'by',
  'class',
  'classes',
  'course',
  'courses',
  'find',
  'for',
  'in',
  'intro',
  'introduction',
  'of',
  'search',
  'the',
  'to',
])

function getDifficultyLabel(score: number): string {
  return getWorkloadTierLabel(score) ?? 'Easy'
}

function getDifficultyTone(score: number): Tone {
  const label = getWorkloadTierLabel(score)
  if (label === 'Hard') return 'destructive'
  if (label === 'Moderate') return 'warning'
  return 'success'
}

function toneTextClass(tone?: Tone): string {
  return cn(
    tone === 'success' && 'text-success',
    tone === 'warning' && 'text-warning',
    tone === 'destructive' && 'text-destructive',
    tone === 'muted' && 'text-muted-foreground'
  )
}

function getCourseKey(course: CourseDto): string {
  return (
    course.id ||
    `${course.subject}-${course.number}-${course.term}-${course.year}`
  )
}

function getCoursePath(course: CourseDto): string {
  return `/course/${course.subject}/${course.number}?term=${course.term}&year=${course.year}`
}

function renderScoreSummary(course: CourseDto) {
  const qualityScore = course.quality_score
  const difficultyScore = course.difficulty_score
  const primaryInstructorRmp = course.primary_instructor_rmp
  const avgGpa = course.avg_gpa
  const stats: CourseResultMetric[] = []

  if (typeof qualityScore === 'number') {
    const qualityLabel = getQualityLabel(qualityScore)
    stats.push({
      label: 'Quality',
      value: qualityLabel,
      tone: getQualityTone(qualityLabel),
      title:
        typeof course.gpa_sample_size === 'number'
          ? `Based on ${course.gpa_sample_size.toLocaleString()} records`
          : undefined,
    })
  }
  if (typeof difficultyScore === 'number') {
    stats.push({
      label: 'Workload',
      value: getDifficultyLabel(difficultyScore),
      tone: getDifficultyTone(difficultyScore),
    })
  }
  if (typeof primaryInstructorRmp === 'number') {
    stats.push({ label: 'Instructor', value: primaryInstructorRmp.toFixed(1) })
  }
  if (typeof avgGpa === 'number') {
    stats.push({
      label: 'Avg GPA',
      value: avgGpa.toFixed(2),
      title:
        typeof course.gpa_sample_size === 'number'
          ? `Based on ${course.gpa_sample_size.toLocaleString()} GPA records`
          : undefined,
    })
  }

  if (stats.length === 0) {
    return null
  }

  return (
    <dl className="mt-3 grid max-w-2xl grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-x-4 gap-y-2 border-t pt-3">
      {stats.map((stat) => (
        <div key={stat.label} title={stat.title} className="min-w-0">
          <dt className="text-muted-foreground text-xs">{stat.label}</dt>
          <dd
            className={cn(
              'text-sm font-semibold tabular-nums',
              toneTextClass(stat.tone)
            )}
          >
            {stat.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function renderMatchEvidence(evidence: MatchEvidence[] | undefined) {
  const labels =
    evidence
      ?.slice(0, 5)
      .map((item) => item.label)
      .filter(Boolean) ?? []

  if (labels.length === 0) {
    return null
  }

  return (
    <div
      className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1"
      aria-label="Match evidence"
    >
      <span className="text-muted-foreground text-xs">Matched</span>
      {labels.map((label, index) => (
        <span
          key={`${label}-${index}`}
          className="text-muted-foreground text-xs"
        >
          {label}
        </span>
      ))}
    </div>
  )
}

function removeTextFromQuery(source: string, textToRemove: string): string {
  const normalizedSource = source.trim()
  const normalizedRemove = textToRemove.trim()
  const index = normalizedSource
    .toLowerCase()
    .indexOf(normalizedRemove.toLowerCase())

  if (index < 0) {
    return normalizedSource
  }

  return `${normalizedSource.slice(0, index)} ${normalizedSource.slice(index + normalizedRemove.length)}`
    .replace(/\s+/g, ' ')
    .trim()
}

function removeChipFromQuery(source: string, chip: SearchChipDto): string {
  if (chip.id === 'gened-any') {
    return source
      .trim()
      .replace(/\b(?:gen\s*-?\s*ed|gened)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  return removeTextFromQuery(source, chip.queryPatch?.removeText || chip.value)
}

function getChipClass(chip: SearchChipDto): string {
  return cn(
    chip.type === 'instructor' &&
      'border-primary/30 bg-primary/5 text-foreground',
    chip.type === 'difficulty' &&
      'border-warning/30 bg-warning/10 text-foreground',
    (chip.type === 'courseCode' || chip.type === 'subject') &&
      'border-primary/30 bg-primary/5 text-foreground',
    chip.type === 'semantic' && 'text-muted-foreground'
  )
}

function formatTermLabel(term: string, year: number): string {
  return `${term.charAt(0).toUpperCase()}${term.slice(1).toLowerCase()} ${year}`
}

function genedLabel(gened: CourseGenedDto): string {
  const category = gened.categoryName ?? gened.categoryId
  if (gened.attributeName) return `${category}: ${gened.attributeName}`
  if (gened.attributeCode) return `${category}: ${gened.attributeCode}`
  return category
}

function courseGenedLabels(course: CourseDto): string[] {
  if (course.geneds.length > 0) {
    return course.geneds.map(genedLabel)
  }
  return course.gened ? [`GenEd ${course.gened}`] : []
}

function readStoredResultViewMode(): ResultViewMode {
  if (typeof window === 'undefined') return 'cards'

  return window.localStorage.getItem(RESULT_VIEW_STORAGE_KEY) === 'table'
    ? 'table'
    : 'cards'
}

function normalizeSearchSort(sort: SearchSort): SearchSort {
  const direction =
    sort.field === 'relevance'
      ? SEARCH_SORT_DEFAULT_DIRECTIONS.relevance
      : sort.direction

  return {
    field: sort.field,
    direction,
  }
}

function nextSortForField(field: SortField, current: SearchSort): SearchSort {
  if (field === current.field && field !== 'relevance') {
    return {
      field,
      direction: current.direction === 'asc' ? 'desc' : 'asc',
    }
  }

  return {
    field,
    direction: SEARCH_SORT_DEFAULT_DIRECTIONS[field],
  }
}

function directionLabel(direction: SortDirection): string {
  return direction === 'asc' ? 'Ascending' : 'Descending'
}

function formatCourseLevel(course: CourseDto): string {
  const number = parseInt(course.number, 10)
  if (Number.isNaN(number)) return '-'

  const level = Math.floor(number / 100) * 100
  return level >= 500 ? '500+' : String(level)
}

function formatNumber(
  value: number | null | undefined,
  digits: number
): string {
  return typeof value === 'number' ? value.toFixed(digits) : '-'
}

function formatCredits(value: number | null): string {
  return typeof value === 'number' ? String(value) : '-'
}

function sortButtonLabel(
  label: string,
  isActive: boolean,
  direction: SortDirection
): string {
  if (!isActive) {
    return `Sort by ${label}, ${directionLabel(direction).toLowerCase()}`
  }

  const nextDirection = direction === 'asc' ? 'desc' : 'asc'
  return `Sort by ${label}, ${directionLabel(nextDirection).toLowerCase()}`
}

function normalizeAdvancedValue(
  value: AdvancedSearchStateDto[keyof AdvancedSearchStateDto]
): string {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value === 'string') return value.trim().toLowerCase()
  return String(value)
}

function advancedValuesEqual(
  left: AdvancedSearchStateDto[keyof AdvancedSearchStateDto],
  right: AdvancedSearchStateDto[keyof AdvancedSearchStateDto]
): boolean {
  return normalizeAdvancedValue(left) === normalizeAdvancedValue(right)
}

function advancedFiltersChanged(
  previous: AdvancedSearchStateDto,
  next: AdvancedSearchStateDto
): boolean {
  return ADVANCED_SEARCH_KEYS.some(
    (key) => !advancedValuesEqual(previous[key], next[key])
  )
}

function hasAdvancedFilterValue(state: AdvancedSearchStateDto): boolean {
  return ADVANCED_SEARCH_KEYS.some((key) =>
    Boolean(normalizeAdvancedValue(state[key]))
  )
}

function cleanAdvancedFilters(
  state: AdvancedSearchStateDto
): AdvancedSearchStateDto {
  const next: AdvancedSearchStateDto = {}

  if (state.subject?.trim()) next.subject = state.subject.trim().toUpperCase()
  if (state.number?.trim()) next.number = state.number.trim()
  if (state.instructor?.trim()) next.instructor = state.instructor.trim()
  if (state.term?.trim()) next.term = state.term.trim().toLowerCase()
  if (typeof state.year === 'number') next.year = state.year
  if (state.gened?.trim()) next.gened = state.gened.trim().toUpperCase()
  if (typeof state.credits === 'number') next.credits = state.credits
  if (state.days?.trim()) next.days = state.days.trim().toUpperCase()
  if (state.time?.trim()) next.time = state.time.trim().toLowerCase()
  if (state.partOfTerm?.trim()) {
    next.partOfTerm = state.partOfTerm.trim().toUpperCase()
  }
  if (state.online !== undefined) next.online = state.online
  if (state.status?.trim()) next.status = state.status.trim().toLowerCase()
  if (state.difficulty === 'easy' || state.difficulty === 'hard') {
    next.difficulty = state.difficulty
  }
  if (
    typeof state.level === 'number' &&
    [100, 200, 300, 400, 500].includes(state.level)
  ) {
    next.level = state.level
  }
  if (state.scope === 'all') {
    next.scope = 'all'
  }

  return next
}

function advancedStateFromFilter(
  filter: Partial<SearchFilters> | undefined
): AdvancedSearchStateDto {
  if (!filter) return {}

  return cleanAdvancedFilters({
    subject: filter.subject,
    number: filter.number,
    term: filter.term,
    year: filter.year,
    gened: filter.gened_code ?? filter.gened_any?.[0] ?? filter.gened_all?.[0],
    credits: filter.credits,
    days: filter.days,
    time: filter.time,
    partOfTerm: filter.partOfTerm,
    online: filter.online,
    status: filter.status,
    difficulty: filter.difficulty,
    level: filter.level,
  })
}

function advancedFiltersForChipRemoval(
  state: AdvancedSearchStateDto,
  chip: SearchChipDto
): AdvancedSearchStateDto | null {
  const next = { ...state }
  let changed = false
  const filter = chip.filter

  if (chip.type === 'instructor' && next.instructor) {
    delete next.instructor
    changed = true
  }

  if (filter?.subject && next.subject === filter.subject) {
    delete next.subject
    changed = true
  }
  if (filter?.number && next.number === filter.number) {
    delete next.number
    changed = true
  }
  if (filter?.term && next.term === filter.term) {
    delete next.term
    changed = true
  }
  if (filter?.year !== undefined && next.year === filter.year) {
    delete next.year
    changed = true
  }
  if (filter?.gened_code && next.gened === filter.gened_code) {
    delete next.gened
    changed = true
  }
  if (filter?.credits !== undefined && next.credits === filter.credits) {
    delete next.credits
    changed = true
  }
  if (filter?.days && next.days === filter.days) {
    delete next.days
    changed = true
  }
  if (filter?.time && next.time === filter.time) {
    delete next.time
    changed = true
  }
  if (filter?.partOfTerm && next.partOfTerm === filter.partOfTerm) {
    delete next.partOfTerm
    changed = true
  }
  if (filter?.online !== undefined && next.online === filter.online) {
    delete next.online
    changed = true
  }
  if (filter?.status && next.status === filter.status) {
    delete next.status
    changed = true
  }
  if (filter?.difficulty && next.difficulty === filter.difficulty) {
    delete next.difficulty
    changed = true
  }
  if (filter?.level !== undefined && next.level === filter.level) {
    delete next.level
    changed = true
  }

  return changed ? cleanAdvancedFilters(next) : null
}

function advancedFiltersContradictQuery(
  previous: AdvancedSearchStateDto,
  next: AdvancedSearchStateDto
): boolean {
  return ADVANCED_CONTRADICTION_KEYS.some((key) => {
    const previousValue = normalizeAdvancedValue(previous[key])
    if (!previousValue) return false

    return !advancedValuesEqual(previous[key], next[key])
  })
}

function meaningfulResidualQuery(residual: string): string {
  const trimmedResidual = residual.trim()
  const meaningfulTokens = trimmedResidual
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter((token) => token && !WEAK_RESIDUAL_TERMS.has(token))

  return meaningfulTokens.length > 0 ? trimmedResidual : ''
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

function ResultsToolbar({
  showingResultsLabel,
  sort,
  resultViewMode,
  isRefreshing,
  onSortFieldChange,
  onDirectionToggle,
  onViewChange,
}: {
  showingResultsLabel: string
  sort: SearchSort
  resultViewMode: ResultViewMode
  isRefreshing: boolean
  onSortFieldChange: (field: SortField) => void
  onDirectionToggle: () => void
  onViewChange: (view: ResultViewMode) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-muted-foreground text-xs tabular-nums">
        {showingResultsLabel}
      </p>
      {isRefreshing && (
        <span
          role="status"
          aria-live="polite"
          className="text-muted-foreground flex items-center gap-1 text-xs"
        >
          <Spinner aria-hidden />
          Updating results
        </span>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-xs">Sort</span>
        <Field className="w-40">
          <FieldLabel htmlFor="results-sort-field" className="sr-only">
            Sort results
          </FieldLabel>
          <Select
            value={sort.field}
            onValueChange={(value) => onSortFieldChange(value as SortField)}
          >
            <SelectTrigger id="results-sort-field" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {SORT_FIELD_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        {sort.field !== 'relevance' && (
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            aria-label={`Sort ${directionLabel(sort.direction).toLowerCase()}`}
            onClick={onDirectionToggle}
          >
            {sort.direction === 'asc' ? (
              <ArrowUpIcon aria-hidden />
            ) : (
              <ArrowDownIcon aria-hidden />
            )}
          </Button>
        )}
        <div
          className="flex rounded-md border bg-background p-0.5"
          role="group"
          aria-label="Result view"
        >
          <Button
            type="button"
            size="xs"
            variant={resultViewMode === 'cards' ? 'secondary' : 'ghost'}
            aria-pressed={resultViewMode === 'cards'}
            onClick={() => onViewChange('cards')}
          >
            <LayoutGridIcon data-icon="inline-start" aria-hidden />
            Cards
          </Button>
          <Button
            type="button"
            size="xs"
            variant={resultViewMode === 'table' ? 'secondary' : 'ghost'}
            aria-pressed={resultViewMode === 'table'}
            onClick={() => onViewChange('table')}
          >
            <Table2Icon data-icon="inline-start" aria-hidden />
            Table
          </Button>
        </div>
      </div>
    </div>
  )
}

function SortableTableHead({
  column,
  sort,
  onSort,
}: {
  column: TableSortColumn
  sort: SearchSort
  onSort: (field: Exclude<SortField, 'relevance'>) => void
}) {
  const isActive = sort.field === column.field
  const direction = isActive
    ? sort.direction
    : SEARCH_SORT_DEFAULT_DIRECTIONS[column.field]

  return (
    <TableHead
      scope="col"
      aria-sort={
        isActive ? (direction === 'asc' ? 'ascending' : 'descending') : undefined
      }
      className={column.className}
    >
      <Button
        type="button"
        size="xs"
        variant="ghost"
        className="-ml-2 justify-start px-2"
        aria-label={sortButtonLabel(column.label, isActive, direction)}
        onClick={() => onSort(column.field)}
      >
        {column.label}
        {isActive &&
          (direction === 'asc' ? (
            <ArrowUpIcon data-icon="inline-end" aria-hidden />
          ) : (
            <ArrowDownIcon data-icon="inline-end" aria-hidden />
          ))}
      </Button>
    </TableHead>
  )
}

function CourseResultsTable({
  results,
  sort,
  onSort,
}: {
  results: CourseDto[]
  sort: SearchSort
  onSort: (field: Exclude<SortField, 'relevance'>) => void
}) {
  return (
    <Table className="min-w-[880px]">
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Course</TableHead>
          <TableHead scope="col">Term</TableHead>
          {TABLE_SORT_COLUMNS.map((column) => (
            <SortableTableHead
              key={column.field}
              column={column}
              sort={sort}
              onSort={onSort}
            />
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {results.map((course) => {
          const isHistorical = course._historical === true
          const qualityLabel =
            typeof course.quality_score === 'number'
              ? getQualityLabel(course.quality_score)
              : null
          const workloadLabel =
            typeof course.difficulty_score === 'number'
              ? getDifficultyLabel(course.difficulty_score)
              : null

          return (
            <TableRow
              key={getCourseKey(course)}
              data-historical={isHistorical ? 'true' : undefined}
              className={cn(isHistorical && 'bg-muted/50')}
            >
              <TableCell className="max-w-80 whitespace-normal">
                <Link
                  to={getCoursePath(course)}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {course.subject} {course.number}
                </Link>
                <div className="text-muted-foreground mt-1 line-clamp-2 text-xs leading-5">
                  {course.title}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex flex-col gap-1">
                  <span>{formatTermLabel(course.term, course.year)}</span>
                  {isHistorical && (
                    <Badge
                      variant="outline"
                      className="w-fit text-muted-foreground"
                    >
                      Historical
                    </Badge>
                  )}
                </div>
              </TableCell>
              <TableCell>
                {qualityLabel ? (
                  <span
                    className={cn(
                      'font-semibold',
                      toneTextClass(getQualityTone(qualityLabel))
                    )}
                  >
                    {qualityLabel}
                  </span>
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </TableCell>
              <TableCell>
                {workloadLabel ? (
                  <span
                    className={cn(
                      'font-semibold',
                      toneTextClass(getDifficultyTone(course.difficulty_score!))
                    )}
                  >
                    {workloadLabel}
                  </span>
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </TableCell>
              <TableCell className="tabular-nums">
                {formatNumber(course.avg_gpa, 2)}
              </TableCell>
              <TableCell className="tabular-nums">
                {formatNumber(course.primary_instructor_rmp, 1)}
              </TableCell>
              <TableCell className="tabular-nums">
                {formatCourseLevel(course)}
              </TableCell>
              <TableCell className="tabular-nums">
                {formatCredits(course.credit_hours)}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

export function SearchPage({ includeH1 = true }: { includeH1?: boolean }) {
  const [query, setQuery] = useState('')
  const [inputDirty, setInputDirty] = useState(false)
  const [activeSearchText, setActiveSearchText] = useState('')
  const [activeAdvancedFilters, setActiveAdvancedFilters] =
    useState<AdvancedSearchStateDto>({})
  const [results, setResults] = useState<CourseDto[]>([])
  const [meta, setMeta] = useState<SearchMetaDto | null>(null)
  const [pagination, setPagination] = useState<SearchPagination | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [advancedDraft, setAdvancedDraft] = useState<AdvancedSearchStateDto>({})
  const [sort, setSort] = useState<SearchSort>(DEFAULT_SEARCH_SORT)
  const [resultViewMode, setResultViewMode] = useState<ResultViewMode>(() =>
    readStoredResultViewMode()
  )

  const searchController = useRef<AbortController | null>(null)

  const hasActiveStructuredFilters = hasAdvancedFilterValue(
    activeAdvancedFilters
  )
  const hasActiveRequest =
    activeSearchText.trim().length > 0 ||
    hasActiveStructuredFilters ||
    meta !== null ||
    loading ||
    loadingMore
  const activeRequestQuery = hasActiveRequest ? activeSearchText : query.trim()

  useEffect(() => {
    window.localStorage.setItem(RESULT_VIEW_STORAGE_KEY, resultViewMode)
  }, [resultViewMode])

  const updateAdvancedDraft = <Key extends keyof AdvancedSearchStateDto>(
    key: Key,
    value: AdvancedSearchStateDto[Key]
  ) => {
    setAdvancedDraft((state) => ({ ...state, [key]: value }))
  }

  const runSearch = async (searchText: string, options: SearchOptions = {}) => {
    const normalizedQuery = searchText.trim()
    const requestFilters = cleanAdvancedFilters(options.filters || {})
    const hasRequestFilters = hasAdvancedFilterValue(requestFilters)
    const requestSort = normalizeSearchSort(options.sort ?? sort)
    if (!normalizedQuery && !hasRequestFilters) return
    const offset = options.offset ?? 0
    const append = options.append === true && offset > 0
    const preserveResults = options.preserveResults === true && !append

    if (searchController.current) {
      searchController.current.abort()
    }
    const controller = new AbortController()
    searchController.current = controller

    if (options.syncInput !== false) {
      setQuery(normalizedQuery)
    }
    if (!append) setInputDirty(false)
    if (!append) {
      setActiveSearchText(normalizedQuery)
      setActiveAdvancedFilters(requestFilters)
    }
    setLoading(!append)
    setLoadingMore(append)
    if (!append && !preserveResults) {
      setMeta(null)
      setResults([])
      setPagination(null)
    }
    setError(null)

    try {
      const data = await api.search(normalizedQuery, {
        signal: controller.signal,
        limit: SEARCH_PAGE_SIZE,
        offset,
        filters: hasRequestFilters ? requestFilters : undefined,
        sort: requestSort,
      })
      const nextResults = data.results || []
      setResults((currentResults) =>
        append ? [...currentResults, ...nextResults] : nextResults
      )
      setMeta(data.meta || null)
      setPagination(data.pagination || null)
      setAdvancedDraft(data.meta?.ui?.advanced || {})
      if (!append) {
        setSort(data.meta?.appliedSort ?? requestSort)
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return
      setError('Give it another moment, or try a broader search.')
    } finally {
      if (searchController.current === controller) {
        setLoading(false)
        setLoadingMore(false)
        searchController.current = null
      }
    }
  }

  const handleSearch = () => {
    void runSearch(query)
  }

  const runExampleSearch = (exampleQuery: string) => {
    void runSearch(exampleQuery)
  }

  const removeChip = (chip: SearchChipDto) => {
    const nextAdvancedFilters = advancedFiltersForChipRemoval(
      activeAdvancedFilters,
      chip
    )
    if (nextAdvancedFilters) {
      setAdvancedDraft(nextAdvancedFilters)
      void runSearch(activeRequestQuery, {
        syncInput: false,
        filters: nextAdvancedFilters,
      })
      return
    }

    const nextQuery = removeChipFromQuery(
      activeRequestQuery || meta?.query.raw || query,
      chip
    )
    if (nextQuery) {
      void runSearch(nextQuery, {
        syncInput: false,
        filters: activeAdvancedFilters,
      })
    }
  }

  const applyAmbiguityAction = (action: SearchAmbiguityActionDto) => {
    const actionFilters = advancedStateFromFilter(action.filter)
    if (hasAdvancedFilterValue(actionFilters)) {
      const baseFilters = cleanAdvancedFilters({
        ...activeAdvancedFilters,
        ...(meta?.ui?.advanced || {}),
      })
      if (action.filter.gened_code) {
        delete baseFilters.subject
        delete baseFilters.number
      }
      if (action.filter.subject) {
        delete baseFilters.gened
      }

      const nextFilters = cleanAdvancedFilters({
        ...baseFilters,
        ...actionFilters,
      })
      setAdvancedDraft(nextFilters)
      void runSearch(meaningfulResidualQuery(meta?.query.residual || ''), {
        syncInput: false,
        filters: nextFilters,
      })
      return
    }

    const nextQuery =
      action.queryPatch?.replaceQuery ||
      action.queryPatch?.appendText ||
      action.label
    void runSearch(nextQuery, {
      syncInput: false,
      filters: activeAdvancedFilters,
    })
  }

  const applyAdvancedSearch = () => {
    const previousAdvanced = meta?.ui?.advanced || {}
    const changed = advancedFiltersChanged(previousAdvanced, advancedDraft)
    const contradictsQuery = advancedFiltersContradictQuery(
      previousAdvanced,
      advancedDraft
    )
    const freeTextQuery = inputDirty
      ? query.trim()
      : contradictsQuery
        ? meaningfulResidualQuery(meta?.query.residual || '')
        : activeRequestQuery
    const nextFilters = cleanAdvancedFilters(advancedDraft)
    const nextQuery = changed ? freeTextQuery : activeRequestQuery

    if (!nextQuery.trim() && !hasAdvancedFilterValue(nextFilters)) return
    if (contradictsQuery && !inputDirty) {
      setQuery(freeTextQuery)
    }

    void runSearch(nextQuery, { syncInput: false, filters: nextFilters })
  }

  const resetAdvancedDraft = () => {
    setAdvancedDraft(meta?.ui?.advanced || {})
  }

  const loadMoreResults = () => {
    if (!pagination?.hasMore) {
      return
    }
    const nextOffset =
      pagination.nextOffset ?? pagination.offset + pagination.limit

    void runSearch(activeRequestQuery, {
      offset: nextOffset,
      append: true,
      syncInput: false,
      filters: activeAdvancedFilters,
      sort,
    })
  }

  const applySort = (nextSort: SearchSort) => {
    const normalizedSort = normalizeSearchSort(nextSort)
    setSort(normalizedSort)
    void runSearch(activeRequestQuery, {
      syncInput: false,
      filters: activeAdvancedFilters,
      sort: normalizedSort,
      preserveResults: true,
    })
  }

  const handleSortFieldChange = (field: SortField) => {
    applySort({
      field,
      direction: SEARCH_SORT_DEFAULT_DIRECTIONS[field],
    })
  }

  const toggleSortDirection = () => {
    if (sort.field === 'relevance') return

    applySort({
      field: sort.field,
      direction: sort.direction === 'asc' ? 'desc' : 'asc',
    })
  }

  const handleTableSort = (field: Exclude<SortField, 'relevance'>) => {
    applySort(nextSortForField(field, sort))
  }

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    handleSearch()
  }

  const resultCountLabel =
    pagination?.total !== undefined
      ? `${pagination.total.toLocaleString()} ${pagination.total === 1 ? 'result' : 'results'}`
      : `${results.length.toLocaleString()} ${results.length === 1 ? 'result' : 'results'}`
  const showingResultsLabel =
    pagination?.total !== undefined && pagination.total > results.length
      ? `Showing ${results.length.toLocaleString()} of ${pagination.total.toLocaleString()}`
      : `Showing ${results.length.toLocaleString()}`
  const resultsHeadingLabel = meta?.query.raw
    ? `Results for ${meta.query.raw}`
    : 'Results matching filters'
  const hasAdvancedDraftChanges = meta
    ? advancedFiltersChanged(meta.ui?.advanced || {}, advancedDraft)
    : hasAdvancedFilterValue(advancedDraft)
  const showFirstRunExamples =
    !meta && !loading && !hasActiveRequest && !error
  const isRefreshingResults = loading && (meta !== null || results.length > 0)
  const showInitialSkeleton = loading && !isRefreshingResults

  return (
    <PageContainer className="py-4 sm:py-6">
      {includeH1 && <h1 className="sr-only">UIUC Course Search</h1>}
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <form role="search" autoComplete="off" onSubmit={handleSearchSubmit}>
          <Field>
            <FieldLabel htmlFor="course-search-query" className="sr-only">
              Course search query
            </FieldLabel>
            <InputGroup className="bg-card h-10">
              <InputGroupAddon>
                <SearchIcon aria-hidden />
              </InputGroupAddon>
              <InputGroupInput
                id="course-search-query"
                autoComplete="off"
                placeholder="Search by course, topic, professor, requirement, or time"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setInputDirty(true)
                }}
              />
            </InputGroup>
          </Field>
        </form>

        {showFirstRunExamples && (
          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground text-sm">
              Search UIUC courses the way you'd describe them.
            </p>
            <div className="flex flex-wrap gap-2">
              {FIRST_RUN_EXAMPLE_QUERIES.map((exampleQuery) => (
                <Button
                  key={exampleQuery}
                  type="button"
                  size="xs"
                  variant="secondary"
                  onClick={() => runExampleSearch(exampleQuery)}
                >
                  {exampleQuery}
                </Button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertCircleIcon aria-hidden />
            <AlertTitle>That search did not go through</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {meta && (
          <Card>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">Refine results</h2>
                  <p className="text-muted-foreground text-xs">
                    {resultCountLabel}
                  </p>
                </div>
                <Button
                  size="xs"
                  variant="outline"
                  aria-expanded={advancedOpen}
                  aria-controls="advanced-search-panel"
                  onClick={() => setAdvancedOpen((value) => !value)}
                >
                  <SlidersHorizontalIcon data-icon="inline-start" aria-hidden />
                  Advanced search
                </Button>
              </div>

              {meta.ui?.chips?.length ? (
                <div className="flex flex-wrap gap-2">
                  {meta.ui.chips.map((chip) => (
                    <Badge
                      key={chip.id}
                      variant={
                        chip.type === 'semantic' ? 'outline' : 'secondary'
                      }
                      className={cn(
                        'h-auto min-h-5 py-0.5 normal-case',
                        getChipClass(chip)
                      )}
                    >
                      {chip.label}
                      {chip.removable && (
                        <Button
                          aria-label={`Remove ${chip.label}`}
                          size="icon-xs"
                          variant="ghost"
                          className="-mr-1 size-4 rounded-[var(--radius-sm)] p-0"
                          onClick={(event) => {
                            event.preventDefault()
                            removeChip(chip)
                          }}
                        >
                          <XIcon aria-hidden />
                        </Button>
                      )}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">
                  Searching by topic.
                </p>
              )}

              {meta.ui?.ambiguityActions?.length ? (
                <div className="flex flex-col gap-2">
                  <p className="text-muted-foreground text-xs">
                    Did you mean a different interpretation?
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {meta.ui.ambiguityActions.map((action) => (
                      <Button
                        key={action.id}
                        size="xs"
                        variant="secondary"
                        onClick={() => applyAmbiguityAction(action)}
                      >
                        Use {action.label}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}

              <Collapsible open={advancedOpen}>
                <CollapsibleContent
                  id="advanced-search-panel"
                  className="border-t pt-4"
                >
                  <div className="flex flex-col gap-5">
                    <FieldSet>
                      <FieldLegend variant="label">Course</FieldLegend>
                      <FieldGroup className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                        <AdvancedTextField
                          id="advanced-subject"
                          label="Subject"
                          maxLength={8}
                          placeholder="CS"
                          value={advancedDraft.subject ?? ''}
                          onChange={(value) =>
                            updateAdvancedDraft(
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
                          placeholder="225"
                          value={advancedDraft.number ?? ''}
                          onChange={(value) =>
                            updateAdvancedDraft('number', value || undefined)
                          }
                        />
                        <AdvancedTextField
                          id="advanced-instructor"
                          label="Instructor"
                          placeholder="Fagen"
                          value={advancedDraft.instructor ?? ''}
                          onChange={(value) =>
                            updateAdvancedDraft(
                              'instructor',
                              value || undefined
                            )
                          }
                        />
                        <AdvancedTextField
                          id="advanced-gened"
                          label="GenEd"
                          maxLength={6}
                          placeholder="HUM"
                          value={advancedDraft.gened ?? ''}
                          onChange={(value) =>
                            updateAdvancedDraft(
                              'gened',
                              value.toUpperCase() || undefined
                            )
                          }
                        />
                        <AdvancedSelectField
                          id="advanced-level"
                          label="Level"
                          placeholder="Any level"
                          value={advancedDraft.level?.toString()}
                          options={LEVEL_OPTIONS}
                          onChange={(value) => {
                            const level = value ? parseInt(value, 10) : NaN
                            updateAdvancedDraft(
                              'level',
                              Number.isNaN(level) ? undefined : level
                            )
                          }}
                        />
                      </FieldGroup>
                    </FieldSet>

                    <FieldSet>
                      <FieldLegend variant="label">
                        Term and meeting
                      </FieldLegend>
                      <FieldGroup className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                        <AdvancedSelectField
                          id="advanced-term"
                          label="Term"
                          placeholder="Any term"
                          value={advancedDraft.term}
                          options={TERM_OPTIONS}
                          onChange={(value) =>
                            updateAdvancedDraft('term', value)
                          }
                        />
                        <AdvancedTextField
                          id="advanced-year"
                          label="Year"
                          inputMode="numeric"
                          maxLength={4}
                          placeholder="2026"
                          value={advancedDraft.year?.toString() ?? ''}
                          onChange={(value) => {
                            const year = parseInt(value, 10)
                            updateAdvancedDraft(
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
                          value={advancedDraft.days ?? ''}
                          onChange={(value) =>
                            updateAdvancedDraft(
                              'days',
                              value.toUpperCase() || undefined
                            )
                          }
                        />
                        <AdvancedSelectField
                          id="advanced-time"
                          label="Time"
                          placeholder="Any time"
                          value={advancedDraft.time}
                          options={TIME_OPTIONS}
                          onChange={(value) =>
                            updateAdvancedDraft('time', value)
                          }
                        />
                        <AdvancedSelectField
                          id="advanced-part-of-term"
                          label="Part of term"
                          placeholder="Any part"
                          value={advancedDraft.partOfTerm}
                          options={PART_OF_TERM_OPTIONS}
                          onChange={(value) =>
                            updateAdvancedDraft('partOfTerm', value)
                          }
                        />
                      </FieldGroup>
                      <AdvancedCheckboxField
                        id="advanced-include-past"
                        label="Include past terms"
                        description="Add historical offerings to the result pool."
                        checked={advancedDraft.scope === 'all'}
                        onChange={(checked) =>
                          updateAdvancedDraft(
                            'scope',
                            checked ? 'all' : undefined
                          )
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
                          value={advancedDraft.credits?.toString() ?? ''}
                          onChange={(value) => {
                            const credits = parseInt(value, 10)
                            updateAdvancedDraft(
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
                            advancedDraft.online === undefined
                              ? undefined
                              : String(advancedDraft.online)
                          }
                          options={DELIVERY_OPTIONS}
                          onChange={(value) =>
                            updateAdvancedDraft(
                              'online',
                              value === undefined ? undefined : value === 'true'
                            )
                          }
                        />
                        <AdvancedSelectField
                          id="advanced-status"
                          label="Status"
                          placeholder="Any status"
                          value={advancedDraft.status}
                          options={STATUS_OPTIONS}
                          onChange={(value) =>
                            updateAdvancedDraft('status', value)
                          }
                        />
                        <AdvancedSelectField
                          id="advanced-workload"
                          label="Workload"
                          placeholder="Any workload"
                          value={advancedDraft.difficulty}
                          options={WORKLOAD_OPTIONS}
                          onChange={(value) =>
                            updateAdvancedDraft(
                              'difficulty',
                              value === 'easy' || value === 'hard'
                                ? value
                                : undefined
                            )
                          }
                        />
                      </FieldGroup>
                    </FieldSet>
                  </div>

                  <div className="mt-4 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-muted-foreground text-xs">
                      Filters apply to the current search text.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={!hasAdvancedDraftChanges}
                        onClick={resetAdvancedDraft}
                      >
                        Reset fields
                      </Button>
                      <Button
                        size="xs"
                        disabled={!hasAdvancedDraftChanges}
                        onClick={applyAdvancedSearch}
                      >
                        Apply filters
                      </Button>
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </CardContent>
          </Card>
        )}

        {meta && (
          <div className="flex justify-end">
            <FeedbackButton
              buttonLabel="Results not right?"
              page="search"
              kind="search_results"
              issue="expected_different_results"
              context={{
                query: meta.query.raw,
                metadata: {
                  resultCount: results.length,
                  hasMore: pagination?.hasMore === true,
                  typedQuery: query.trim() || null,
                  effectiveQuery: activeRequestQuery || null,
                },
              }}
            />
          </div>
        )}

        <div aria-busy={loading} className="flex flex-col gap-3">
          {!meta && !loading ? null : showInitialSkeleton ? (
            <div
              role="status"
              aria-live="polite"
              aria-label="Searching courses"
              className="flex flex-col gap-3"
            >
              {[0, 1, 2].map((index) => (
                <Card key={index}>
                  <CardContent className="flex flex-col gap-3">
                    <Skeleton className="h-5 w-1/2" />
                    <Skeleton className="h-3 w-3/4" />
                    <Skeleton className="h-3 w-2/3" />
                    <Skeleton className="h-12 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : results.length === 0 && meta ? (
            <Empty role="status" className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <SearchIcon aria-hidden />
                </EmptyMedia>
                <EmptyTitle>Nothing matched that search.</EmptyTitle>
                <EmptyDescription>
                  Try removing a filter or using a broader phrase.
                </EmptyDescription>
              </EmptyHeader>
              {meta.ui?.chips?.length ? (
                <EmptyContent>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      removeChip(
                        meta.ui!.chips.find((chip) => chip.removable) ??
                          meta.ui!.chips[0]
                      )
                    }
                  >
                    Remove one filter
                  </Button>
                </EmptyContent>
              ) : null}
            </Empty>
          ) : (
            <div className="flex flex-col gap-3">
              {meta && (
                <div className="flex flex-wrap items-end justify-between gap-3 py-1">
                  <div>
                    <h2 className="font-semibold">{resultsHeadingLabel}</h2>
                  </div>
                  <ResultsToolbar
                    showingResultsLabel={showingResultsLabel}
                    sort={sort}
                    resultViewMode={resultViewMode}
                    isRefreshing={isRefreshingResults}
                    onSortFieldChange={handleSortFieldChange}
                    onDirectionToggle={toggleSortDirection}
                    onViewChange={setResultViewMode}
                  />
                </div>
              )}
              <p className="sr-only" aria-live="polite">
                {resultViewMode === 'table'
                  ? 'Table view selected'
                  : 'Cards view selected'}
              </p>
              {resultViewMode === 'table' ? (
                <CourseResultsTable
                  results={results}
                  sort={sort}
                  onSort={handleTableSort}
                />
              ) : (
                results.map((course) => {
                  const isHistorical = course._historical === true

                  return (
                    <Link
                      key={getCourseKey(course)}
                      to={getCoursePath(course)}
                      className="text-foreground block no-underline"
                    >
                      <Card
                        className={cn(
                          'hover:bg-muted/60 transition-colors',
                          isHistorical && 'border-border bg-muted/60'
                        )}
                        data-historical={isHistorical ? 'true' : undefined}
                      >
                        <CardContent>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <h3
                                className={cn(
                                  'min-w-0 flex-1 text-base leading-snug font-bold break-words',
                                  isHistorical && 'text-muted-foreground'
                                )}
                              >
                                {course.subject} {course.number}:{' '}
                                {course.title}
                              </h3>
                            </div>
                            <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                              <span
                                className={cn(isHistorical && 'font-semibold')}
                              >
                                {formatTermLabel(course.term, course.year)}
                              </span>
                              {isHistorical && (
                                <Badge
                                  variant="outline"
                                  className="text-muted-foreground"
                                >
                                  Historical term
                                </Badge>
                              )}
                              <span>{course.credit_hours} credits</span>
                              {course.primary_instructor && (
                                <span className="border-l pl-2">
                                  {course.primary_instructor}
                                </span>
                              )}
	                              {courseGenedLabels(course).map((label) => (
	                                <span key={label}>{label}</span>
	                              ))}
                            </div>
                            {renderScoreSummary(course)}
                            <p
                              className={cn(
                                'text-muted-foreground mt-2 line-clamp-3 max-w-3xl text-sm leading-6',
                                isHistorical && 'opacity-80'
                              )}
                            >
                              {course.description}
                            </p>
                            {renderMatchEvidence(course.match_evidence)}
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  )
                })
              )}
              {pagination?.hasMore && (
                <div className="flex justify-center pt-2">
                  <Button
                    variant="secondary"
                    onClick={loadMoreResults}
                    disabled={loadingMore}
                  >
                    {loadingMore && (
                      <Spinner data-icon="inline-start" aria-hidden />
                    )}
                    Show more results
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </PageContainer>
  )
}
