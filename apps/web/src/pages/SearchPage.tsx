import { useRef, useState } from 'react'
import { ActionIcon, Alert, Box, Button, Card, Collapse, Container, Flex, Group, Loader, Paper, Select, SimpleGrid, Skeleton, Stack, Text, TextInput, Badge } from '@mantine/core'
import { IconAdjustments, IconAlertCircle, IconSearch, IconX } from '@tabler/icons-react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api-client'
import { FeedbackButton } from '../components/FeedbackButton'
import type { AdvancedSearchStateDto, CourseDto, MatchEvidence, SearchAmbiguityActionDto, SearchChipDto, SearchMetaDto, SearchResponseDto } from '@uiuc-course-search/query-types'
import { getLetterGrade } from '../utils/grading'
import { DIFFICULTY } from '../config/constants'

const SEARCH_PAGE_SIZE = 20
type SearchPagination = SearchResponseDto['pagination']
type SearchOptions = {
  offset?: number
  append?: boolean
  syncInput?: boolean
}
type CourseResultMetric = {
  label: string
  value: string
  title?: string
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

function getRelevanceLabel(score: number): string {
  if (score >= 0.9) return 'Strong match'
  if (score >= 0.75) return 'Good match'
  return 'Possible match'
}

function getCourseKey(course: CourseDto): string {
  return course.id || `${course.subject}-${course.number}-${course.term}-${course.year}`
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
    stats.push({ label: 'Quality', value: getLetterGrade(qualityScore) })
  }
  if (typeof difficultyScore === 'number') {
    stats.push({ label: 'Workload', value: getDifficultyLabel(difficultyScore) })
  }
  if (typeof primaryInstructorRmp === 'number') {
    stats.push({ label: 'Instructor', value: primaryInstructorRmp.toFixed(1) })
  }
  if (typeof avgGpa === 'number') {
    stats.push({
      label: 'Avg GPA',
      value: avgGpa.toFixed(2),
      title: typeof course.gpa_sample_size === 'number'
        ? `Based on ${course.gpa_sample_size.toLocaleString()} GPA records`
        : undefined,
    })
  }

  if (stats.length === 0) {
    return null
  }

  return (
    <Box component="dl" className="course-result-metrics" mt="sm">
      {stats.map((stat) => (
        <Box key={stat.label} className="course-result-metric" title={stat.title}>
          <Text component="dt" size="xs" c="dimmed" className="course-result-metric-label">
            {stat.label}
          </Text>
          <Text component="dd" size="sm" fw={600} className="course-result-metric-value">
            {stat.value}
          </Text>
        </Box>
      ))}
    </Box>
  )
}

function renderMatchEvidence(evidence: MatchEvidence[] | undefined) {
  const labels = evidence?.slice(0, 5).map((item) => item.label).filter(Boolean) ?? []

  if (labels.length === 0) {
    return null
  }

  return (
    <Group gap="xs" mt={6} aria-label="Match evidence">
      <Text size="xs" c="dimmed">Matched</Text>
      {labels.map((label, index) => (
        <Text key={`${label}-${index}`} size="xs" c="dimmed">{label}</Text>
      ))}
    </Group>
  )
}

function removeTextFromQuery(source: string, textToRemove: string): string {
  const normalizedSource = source.trim()
  const normalizedRemove = textToRemove.trim()
  const index = normalizedSource.toLowerCase().indexOf(normalizedRemove.toLowerCase())

  if (index < 0) {
    return normalizedSource
  }

  return `${normalizedSource.slice(0, index)} ${normalizedSource.slice(index + normalizedRemove.length)}`
    .replace(/\s+/g, ' ')
    .trim()
}

function buildAdvancedQuery(state: AdvancedSearchStateDto, fallbackQuery: string): string {
  const tokens: string[] = []

  if (state.subject && state.number) {
    tokens.push(`${state.subject.toUpperCase()} ${state.number}`)
  } else if (state.subject) {
    tokens.push(`subject:${state.subject.toUpperCase()}`)
  }
  if (state.instructor) tokens.push(`professor ${state.instructor}`)
  if (state.gened) tokens.push(`gened:${state.gened.toUpperCase()}`)
  if (state.term && state.year) tokens.push(`${state.term.toLowerCase()} ${state.year}`)
  if (state.credits) tokens.push(`${state.credits} credits`)
  if (state.days) tokens.push(state.days.toUpperCase())
  if (state.time) tokens.push(state.time.toLowerCase())
  if (state.online !== undefined) tokens.push(state.online ? 'online' : 'in person')
  if (state.status) tokens.push(state.status.toLowerCase())
  if (state.difficulty) tokens.push(state.difficulty)

  if (fallbackQuery.trim()) tokens.push(fallbackQuery.trim())

  return tokens.join(' ').trim()
}

function getChipColor(chip: SearchChipDto): string {
  if (chip.type === 'semantic') return 'stone'
  if (chip.type === 'instructor') return 'orange'
  if (chip.type === 'gened') return 'stone'
  if (chip.type === 'difficulty') return 'orange'
  if (chip.type === 'courseCode' || chip.type === 'subject') return 'orange'
  return 'stone'
}

function formatTermLabel(term: string, year: number): string {
  return `${term.charAt(0).toUpperCase()}${term.slice(1).toLowerCase()} ${year}`
}

function normalizeAdvancedValue(value: AdvancedSearchStateDto[keyof AdvancedSearchStateDto]): string {
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

function advancedFiltersChanged(previous: AdvancedSearchStateDto, next: AdvancedSearchStateDto): boolean {
  return ADVANCED_SEARCH_KEYS.some((key) => !advancedValuesEqual(previous[key], next[key]))
}

function hasAdvancedFilterValue(state: AdvancedSearchStateDto): boolean {
  return ADVANCED_SEARCH_KEYS.some((key) => Boolean(normalizeAdvancedValue(state[key])))
}

function advancedFiltersContradictQuery(previous: AdvancedSearchStateDto, next: AdvancedSearchStateDto): boolean {
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

export function SearchPage() {
  const [query, setQuery] = useState('')
  const [activeSearchText, setActiveSearchText] = useState('')
  const [results, setResults] = useState<CourseDto[]>([])
  const [meta, setMeta] = useState<SearchMetaDto | null>(null)
  const [pagination, setPagination] = useState<SearchPagination | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [advancedDraft, setAdvancedDraft] = useState<AdvancedSearchStateDto>({})

  // Ref to hold the current AbortController
  const searchController = useRef<AbortController | null>(null)

  const updateAdvancedDraft = <Key extends keyof AdvancedSearchStateDto>(
    key: Key,
    value: AdvancedSearchStateDto[Key]
  ) => {
    setAdvancedDraft((state) => ({ ...state, [key]: value }))
  }

  const runSearch = async (searchText: string, options: SearchOptions = {}) => {
    const normalizedQuery = searchText.trim()
    if (!normalizedQuery) return
    const offset = options.offset ?? 0
    const append = options.append === true && offset > 0

    // Cancel previous request if it exists
    if (searchController.current) {
      searchController.current.abort()
    }
    // Create new controller for this request
    const controller = new AbortController()
    searchController.current = controller

    if (options.syncInput !== false) {
      setQuery(normalizedQuery)
    }
    if (!append) {
      setActiveSearchText(normalizedQuery)
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
      })
      const nextResults = data.results || []
      setResults((currentResults) => append ? [...currentResults, ...nextResults] : nextResults)
      setMeta(data.meta || null)
      setPagination(data.pagination || null)
      setAdvancedDraft(data.meta?.ui?.advanced || {})
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'An unknown error occurred')
    } finally {
      // Only turn off loading if this is still the active request
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

  const removeChip = (chip: SearchChipDto) => {
    const removeText = chip.queryPatch?.removeText || chip.value
    const nextQuery = removeTextFromQuery(activeSearchText || meta?.query.raw || query, removeText)
    if (nextQuery) {
      void runSearch(nextQuery, { syncInput: false })
    }
  }

  const applyAmbiguityAction = (action: SearchAmbiguityActionDto) => {
    const nextQuery = action.queryPatch?.replaceQuery || action.queryPatch?.appendText || action.label
    void runSearch(nextQuery, { syncInput: false })
  }

  const applyAdvancedSearch = () => {
    const previousAdvanced = meta?.ui?.advanced || {}
    const changed = advancedFiltersChanged(previousAdvanced, advancedDraft)
    const contradictsQuery = advancedFiltersContradictQuery(previousAdvanced, advancedDraft)
    const freeTextQuery = contradictsQuery ? meaningfulResidualQuery(meta?.query.residual || '') : query.trim()
    const nextQuery = changed
      ? buildAdvancedQuery(advancedDraft, freeTextQuery)
      : activeSearchText || query

    if (!nextQuery.trim()) return
    if (contradictsQuery) {
      setQuery(freeTextQuery)
    }

    void runSearch(nextQuery, { syncInput: false })
  }

  const clearAdvancedDraft = () => {
    setAdvancedDraft({})
  }

  const loadMoreResults = () => {
    if (!pagination?.hasMore) {
      return
    }
    const nextOffset = pagination.nextOffset ?? pagination.offset + pagination.limit

    void runSearch(activeSearchText || query, { offset: nextOffset, append: true, syncInput: false })
  }

  const handleSearchSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    handleSearch()
  }

  const resultCountLabel = pagination?.total !== undefined
    ? `${pagination.total.toLocaleString()} ${pagination.total === 1 ? 'result' : 'results'}`
    : `${results.length.toLocaleString()} ${results.length === 1 ? 'result' : 'results'}`
  const showingResultsLabel = pagination?.total !== undefined && pagination.total > results.length
    ? `Showing ${results.length.toLocaleString()} of ${pagination.total.toLocaleString()}`
    : `Showing ${results.length.toLocaleString()}`
  const hasDraftFilters = hasAdvancedFilterValue(advancedDraft)

  return (
    <Container size="xl" py={{ base: 'sm', sm: 'lg' }} className="search-page-container">
      <Box className="search-page-shell">
        <Box component="form" role="search" className="search-form" autoComplete="off" onSubmit={handleSearchSubmit}>
          <TextInput
            aria-label="Course search query"
            autoComplete="off"
            placeholder="Search by course, topic, professor, requirement, or time"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            leftSection={<IconSearch size={16} />}
            radius="sm"
            size="md"
          />
        </Box>

        {error && (
          <Alert role="alert" variant="light" color="red" title="Search failed" icon={<IconAlertCircle />} mb="md">
            {error}
          </Alert>
        )}

        {meta && (
          <Paper p="md" withBorder mb="md" className="search-refinement-panel">
            <Group justify="space-between" align="center" gap="xs" mb="xs">
              <Box>
                <Text size="sm" fw={600}>Refine results</Text>
                <Text size="xs" c="dimmed">{resultCountLabel}</Text>
              </Box>
              <Button
                size="xs"
                variant="outline"
                leftSection={<IconAdjustments size={14} />}
                aria-expanded={advancedOpen}
                aria-controls="advanced-search-panel"
                onClick={() => setAdvancedOpen((value) => !value)}
              >
                Advanced search
              </Button>
            </Group>

            {meta.ui?.chips.length ? (
              <Group gap="xs">
                {meta.ui.chips.map((chip) => (
                  <Badge
                    key={chip.id}
                    color={getChipColor(chip)}
                    variant={chip.type === 'semantic' ? 'outline' : 'light'}
                    tt="none"
                    rightSection={chip.removable ? (
                      <ActionIcon
                        aria-label={`Remove ${chip.label}`}
                        size="xs"
                        variant="transparent"
                        color="gray"
                        onClick={(event) => {
                          event.preventDefault()
                          removeChip(chip)
                        }}
                      >
                        <IconX size={10} />
                      </ActionIcon>
                    ) : undefined}
                  >
                    {chip.label}
                  </Badge>
                ))}
              </Group>
            ) : (
              <Text size="sm" c="dimmed">Searching by topic.</Text>
            )}

            {meta.ui?.ambiguityActions.length ? (
              <Stack gap={4} mt="sm">
                <Text size="xs" c="dimmed">Another interpretation is available:</Text>
                <Group gap="xs">
                  {meta.ui.ambiguityActions.map((action) => (
                    <Button
                      key={action.id}
                      size="xs"
                      variant="light"
                      onClick={() => applyAmbiguityAction(action)}
                    >
                      Use {action.label}
                    </Button>
                  ))}
                </Group>
              </Stack>
            ) : null}

            <Collapse in={advancedOpen} transitionDuration={0}>
              <Box id="advanced-search-panel" className="advanced-search-panel">
                <Stack gap="md">
                  <Box component="fieldset" className="advanced-filter-group">
                    <Text component="legend" size="xs" fw={600} className="advanced-filter-legend">
                      Course
                    </Text>
                    <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="xs">
                      <TextInput
                        label="Subject"
                        autoComplete="off"
                        autoCapitalize="characters"
                        maxLength={8}
                        placeholder="CS"
                        value={advancedDraft.subject ?? ''}
                        onChange={(event) => updateAdvancedDraft('subject', event.currentTarget.value.toUpperCase() || undefined)}
                      />
                      <TextInput
                        label="Course number"
                        autoComplete="off"
                        inputMode="numeric"
                        maxLength={4}
                        placeholder="225"
                        value={advancedDraft.number ?? ''}
                        onChange={(event) => updateAdvancedDraft('number', event.currentTarget.value || undefined)}
                      />
                      <TextInput
                        label="Instructor"
                        autoComplete="off"
                        placeholder="Fagen"
                        value={advancedDraft.instructor ?? ''}
                        onChange={(event) => updateAdvancedDraft('instructor', event.currentTarget.value || undefined)}
                      />
                      <TextInput
                        label="GenEd"
                        autoComplete="off"
                        autoCapitalize="characters"
                        maxLength={6}
                        placeholder="HUM"
                        value={advancedDraft.gened ?? ''}
                        onChange={(event) => updateAdvancedDraft('gened', event.currentTarget.value.toUpperCase() || undefined)}
                      />
                    </SimpleGrid>
                  </Box>

                  <Box component="fieldset" className="advanced-filter-group">
                    <Text component="legend" size="xs" fw={600} className="advanced-filter-legend">
                      Term and meeting
                    </Text>
                    <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="xs">
                      <Select
                        label="Term"
                        placeholder="Any term"
                        value={advancedDraft.term ?? null}
                        data={[
                          { value: 'spring', label: 'Spring' },
                          { value: 'summer', label: 'Summer' },
                          { value: 'fall', label: 'Fall' },
                          { value: 'winter', label: 'Winter' },
                        ]}
                        clearable
                        onChange={(value) => updateAdvancedDraft('term', value ?? undefined)}
                      />
                      <TextInput
                        label="Year"
                        autoComplete="off"
                        inputMode="numeric"
                        maxLength={4}
                        placeholder="2026"
                        value={advancedDraft.year?.toString() ?? ''}
                        onChange={(event) => {
                          const year = parseInt(event.currentTarget.value, 10)
                          updateAdvancedDraft('year', Number.isNaN(year) ? undefined : year)
                        }}
                      />
                      <TextInput
                        label="Days"
                        autoComplete="off"
                        autoCapitalize="characters"
                        maxLength={7}
                        placeholder="MWF"
                        value={advancedDraft.days ?? ''}
                        onChange={(event) => updateAdvancedDraft('days', event.currentTarget.value.toUpperCase() || undefined)}
                      />
                      <Select
                        label="Time"
                        placeholder="Any time"
                        value={advancedDraft.time ?? null}
                        data={[
                          { value: 'morning', label: 'Morning' },
                          { value: 'afternoon', label: 'Afternoon' },
                          { value: 'evening', label: 'Evening' },
                        ]}
                        clearable
                        onChange={(value) => updateAdvancedDraft('time', value ?? undefined)}
                      />
                    </SimpleGrid>
                  </Box>

                  <Box component="fieldset" className="advanced-filter-group">
                    <Text component="legend" size="xs" fw={600} className="advanced-filter-legend">
                      Preferences
                    </Text>
                    <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="xs">
                      <TextInput
                        label="Credits"
                        autoComplete="off"
                        inputMode="numeric"
                        maxLength={2}
                        placeholder="3"
                        value={advancedDraft.credits?.toString() ?? ''}
                        onChange={(event) => {
                          const credits = parseInt(event.currentTarget.value, 10)
                          updateAdvancedDraft('credits', Number.isNaN(credits) ? undefined : credits)
                        }}
                      />
                      <Select
                        label="Delivery"
                        placeholder="Any delivery"
                        value={advancedDraft.online === undefined ? null : String(advancedDraft.online)}
                        data={[
                          { value: 'true', label: 'Online' },
                          { value: 'false', label: 'In person' },
                        ]}
                        clearable
                        onChange={(value) => updateAdvancedDraft('online', value === null ? undefined : value === 'true')}
                      />
                      <Select
                        label="Status"
                        placeholder="Any status"
                        value={advancedDraft.status ?? null}
                        data={[
                          { value: 'open', label: 'Open' },
                          { value: 'closed', label: 'Closed' },
                        ]}
                        clearable
                        onChange={(value) => updateAdvancedDraft('status', value ?? undefined)}
                      />
                      <Select
                        label="Workload"
                        placeholder="Any workload"
                        value={advancedDraft.difficulty ?? null}
                        data={[
                          { value: 'easy', label: 'Easier' },
                          { value: 'hard', label: 'Harder' },
                        ]}
                        clearable
                        onChange={(value) => updateAdvancedDraft('difficulty', value === 'easy' || value === 'hard' ? value : undefined)}
                      />
                    </SimpleGrid>
                  </Box>
                </Stack>

                <Group justify="space-between" align="center" mt="md" className="advanced-search-actions">
                  <Text size="xs" c="dimmed">Filters apply to the current search text.</Text>
                  <Group gap="xs" justify="flex-end">
                    <Button size="xs" variant="default" disabled={!hasDraftFilters} onClick={clearAdvancedDraft}>
                      Clear fields
                    </Button>
                    <Button size="xs" onClick={applyAdvancedSearch}>Apply filters</Button>
                  </Group>
                </Group>
              </Box>
            </Collapse>
          </Paper>
        )}

        {meta && (
          <Box mb="md" className="search-feedback-row">
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
          </Box>
        )}

        <Box aria-busy={loading} className="search-results-region">
          {loading ? (
            <Stack gap="sm" role="status" aria-live="polite" aria-label="Searching courses">
              {[0, 1, 2].map((index) => (
                <Card key={index} withBorder padding="md" shadow="none" className="course-result-card course-result-card--skeleton">
                  <Skeleton height={18} width="45%" radius="xs" />
                  <Skeleton height={12} width="70%" mt="sm" radius="xs" />
                  <Skeleton height={12} width="58%" mt="xs" radius="xs" />
                  <Skeleton height={42} mt="md" radius="xs" />
                </Card>
              ))}
              <Loader aria-hidden size="xs" className="search-loading-dot" />
            </Stack>
          ) : (
            results.length === 0 && meta ? (
              <Text c="dimmed" ta="center" py="xl" role="status">No courses found matching your criteria.</Text>
            ) : (
              <Stack gap="sm">
                {meta && (
                  <Group justify="space-between" align="flex-end" gap="xs" className="search-results-summary">
                    <Box>
                      <Text fw={600}>Results for {meta.query.raw}</Text>
                      <Text size="xs" c="dimmed">{showingResultsLabel}</Text>
                    </Box>
                  </Group>
                )}
                {results.map((r) => {
                  const isHistorical = r._historical === true

                  return (
                    <Card
                      key={getCourseKey(r)}
                      withBorder
                      padding="md"
                      component={Link}
                      to={getCoursePath(r)}
                      className={isHistorical ? 'course-result-card course-result-card--historical' : 'course-result-card'}
                      data-historical={isHistorical ? 'true' : undefined}
                      shadow="none"
                    >
                      <Flex justify="space-between" align="flex-start" gap="sm" wrap="wrap">
                        <Box className="course-result-body">
                          <Box className="course-result-heading">
                            <Text fw={700} c={isHistorical ? 'dimmed' : undefined} className="course-result-title">
                              {r.subject} {r.number}: {r.title}
                            </Text>
                            {typeof r._score === 'number' && (
                              <Text size="xs" c="dimmed" fw={600} className="course-result-relevance">
                                {getRelevanceLabel(r._score)}
                              </Text>
                            )}
                          </Box>
                          <Group gap="xs" mt={4} className="course-result-meta-row">
                            <Text size="xs" fw={isHistorical ? 600 : undefined} c={isHistorical ? 'gray.7' : 'dimmed'}>
                              {formatTermLabel(r.term, r.year)}
                            </Text>
                            {isHistorical && (
                              <Badge color="gray" variant="outline" size="xs" tt="none">
                                Historical term
                              </Badge>
                            )}
                            <Text size="xs" c={isHistorical ? 'gray.7' : 'dimmed'}>
                              {r.credit_hours} credits
                            </Text>
                            {r.primary_instructor && (
                              <Text size="xs" c="dimmed" className="course-result-meta-separated">
                                {r.primary_instructor}
                              </Text>
                            )}
                            {r.gened && <Text size="xs" c="dimmed">GenEd {r.gened}</Text>}
                          </Group>
                          {renderScoreSummary(r)}
                          <Text size="sm" mt="xs" lineClamp={3} c={isHistorical ? 'gray.6' : 'dimmed'} className="course-result-description">
                            {r.description}
                          </Text>
                          {renderMatchEvidence(r.match_evidence)}
                        </Box>
                      </Flex>
                    </Card>
                  )
                })}
                {pagination?.hasMore && (
                  <Group justify="center" mt="sm">
                    <Button
                      variant="light"
                      onClick={loadMoreResults}
                      loading={loadingMore}
                      disabled={loadingMore}
                    >
                      Show more results
                    </Button>
                  </Group>
                )}
              </Stack>
            )
          )
          }
        </Box>
      </Box>
    </Container>
  )
}
