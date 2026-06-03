import {
  useRef,
  useState,
  type FormEvent,
  type InputHTMLAttributes,
} from 'react'
import {
  AlertCircleIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  XIcon,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api-client'
import { FeedbackButton } from '../components/FeedbackButton'
import type {
  AdvancedSearchStateDto,
  CourseDto,
  MatchEvidence,
  SearchAmbiguityActionDto,
  SearchChipDto,
  SearchFilters,
  SearchMetaDto,
  SearchResponseDto,
} from '@uiuc-course-search/query-types'
import { getQualityLabel, getQualityTone } from '../utils/grading'
import { DIFFICULTY } from '../config/constants'
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
import { PageContainer } from '@/components/PageContainer'
import { cn } from '@/lib/utils'

const SEARCH_PAGE_SIZE = 20
const ANY_SELECT_VALUE = '__any__'

type SearchPagination = SearchResponseDto['pagination']
type SearchOptions = {
  offset?: number
  append?: boolean
  syncInput?: boolean
  filters?: AdvancedSearchStateDto
}
type Tone = 'success' | 'warning' | 'destructive' | 'muted'
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
  'online',
  'status',
  'difficulty',
]

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
  if (score > DIFFICULTY.HARD) return 'Hard'
  if (score > DIFFICULTY.MODERATE) return 'Moderate'
  return 'Easy'
}

function getDifficultyTone(score: number): Tone {
  if (score > DIFFICULTY.HARD) return 'destructive'
  if (score > DIFFICULTY.MODERATE) return 'warning'
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
  if (state.online !== undefined) next.online = state.online
  if (state.status?.trim()) next.status = state.status.trim().toLowerCase()
  if (state.difficulty === 'easy' || state.difficulty === 'hard') {
    next.difficulty = state.difficulty
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
    online: filter.online,
    status: filter.status,
    difficulty: filter.difficulty,
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

  return changed ? cleanAdvancedFilters(next) : null
}

function advancedFiltersContradictQuery(
  previous: AdvancedSearchStateDto,
  next: AdvancedSearchStateDto
): boolean {
  return ADVANCED_SEARCH_KEYS.some((key) => {
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

export function SearchPage({ includeH1 = true }: { includeH1?: boolean }) {
  const [query, setQuery] = useState('')
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

  const searchController = useRef<AbortController | null>(null)

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
    if (!normalizedQuery && !hasRequestFilters) return
    const offset = options.offset ?? 0
    const append = options.append === true && offset > 0

    if (searchController.current) {
      searchController.current.abort()
    }
    const controller = new AbortController()
    searchController.current = controller

    if (options.syncInput !== false) {
      setQuery(normalizedQuery)
    }
    if (!append) {
      setActiveSearchText(normalizedQuery)
      setActiveAdvancedFilters(requestFilters)
    }
    setLoading(!append)
    setLoadingMore(append)
    if (!append) {
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
      })
      const nextResults = data.results || []
      setResults((currentResults) =>
        append ? [...currentResults, ...nextResults] : nextResults
      )
      setMeta(data.meta || null)
      setPagination(data.pagination || null)
      setAdvancedDraft(data.meta?.ui?.advanced || {})
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
      void runSearch(query.trim(), {
        syncInput: false,
        filters: nextAdvancedFilters,
      })
      return
    }

    const nextQuery = removeChipFromQuery(
      activeSearchText || meta?.query.raw || query,
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
    const freeTextQuery = contradictsQuery
      ? meaningfulResidualQuery(meta?.query.residual || '')
      : query.trim()
    const nextFilters = cleanAdvancedFilters(advancedDraft)
    const nextQuery = changed ? freeTextQuery : activeSearchText || query

    if (!nextQuery.trim() && !hasAdvancedFilterValue(nextFilters)) return
    if (contradictsQuery) {
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

    void runSearch(activeSearchText || query, {
      offset: nextOffset,
      append: true,
      syncInput: false,
      filters: activeAdvancedFilters,
    })
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
  const showFirstRunExamples = !meta && !loading && !activeSearchText && !error

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
                onChange={(event) => setQuery(event.target.value)}
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
                      <FieldGroup className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                      </FieldGroup>
                    </FieldSet>

                    <FieldSet>
                      <FieldLegend variant="label">
                        Term and meeting
                      </FieldLegend>
                      <FieldGroup className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                      </FieldGroup>
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
                  effectiveQuery: activeSearchText || meta.query.raw,
                },
              }}
            />
          </div>
        )}

        <div aria-busy={loading} className="flex flex-col gap-3">
          {loading ? (
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
                <div className="flex flex-wrap items-end justify-between gap-2 py-1">
                  <div>
                    <h2 className="font-semibold">{resultsHeadingLabel}</h2>
                    <p className="text-muted-foreground text-xs">
                      {showingResultsLabel}
                    </p>
                  </div>
                </div>
              )}
              {results.map((course) => {
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
                              {course.subject} {course.number}: {course.title}
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
                            {course.gened && <span>GenEd {course.gened}</span>}
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
              })}
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
