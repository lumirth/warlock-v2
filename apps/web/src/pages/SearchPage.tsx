import { useState, useRef } from 'react'
import { ActionIcon, Alert, Box, Button, Card, Collapse, Container, Flex, Group, Loader, Paper, Select, SimpleGrid, Stack, Text, TextInput, Title, Badge } from '@mantine/core'
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

function getEvidenceColor(evidence: MatchEvidence): string {
  if (evidence.weight === 'hard') return 'blue'
  if (evidence.weight === 'rank') return evidence.kind === 'semantic' ? 'violet' : 'gray'
  return 'teal'
}

function getDifficultyLabel(score: number): string {
  if (score > DIFFICULTY.HARD) return 'Hard'
  if (score > DIFFICULTY.MODERATE) return 'Moderate'
  return 'Easy'
}

function getDifficultyColor(score: number): string {
  if (score > DIFFICULTY.HARD) return 'red'
  if (score > DIFFICULTY.MODERATE) return 'yellow'
  return 'teal'
}

function getRelevanceLabel(score: number): string {
  if (score >= 0.9) return 'Strong match'
  if (score >= 0.75) return 'Good match'
  return 'Possible match'
}

function renderScoreBadges(course: CourseDto) {
  const qualityScore = course.quality_score
  const difficultyScore = course.difficulty_score
  const primaryInstructorRmp = course.primary_instructor_rmp
  const avgGpa = course.avg_gpa

  const hasQuality = typeof qualityScore === 'number'
  const hasDifficulty = typeof difficultyScore === 'number'
  const hasRating = typeof primaryInstructorRmp === 'number'
  const hasGpa = typeof avgGpa === 'number'

  if (!hasQuality && !hasDifficulty && !hasRating && !hasGpa) {
    return null
  }

  return (
    <Group gap={4} mt={6}>
      {hasQuality && (
        <Badge size="xs" variant="light" color="blue" tt="none">
          Quality {getLetterGrade(qualityScore)}
        </Badge>
      )}
      {hasDifficulty && (
        <Badge size="xs" variant="light" color={getDifficultyColor(difficultyScore)} tt="none">
          {getDifficultyLabel(difficultyScore)} workload
        </Badge>
      )}
      {hasRating && (
        <Badge size="xs" variant="light" color={primaryInstructorRmp >= 3.5 ? 'teal' : 'orange'} tt="none">
          Instructor rating {primaryInstructorRmp.toFixed(1)}
        </Badge>
      )}
      {hasGpa && (
        <Badge
          size="xs"
          variant="light"
          color="cyan"
          tt="none"
          title={typeof course.gpa_sample_size === 'number' ? `Based on ${course.gpa_sample_size.toLocaleString()} GPA records` : undefined}
        >
          Avg GPA {avgGpa.toFixed(2)}
        </Badge>
      )}
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
  if (chip.type === 'semantic') return 'gray'
  if (chip.type === 'instructor') return 'teal'
  if (chip.type === 'gened') return 'yellow'
  if (chip.type === 'difficulty') return 'orange'
  if (chip.type === 'courseCode' || chip.type === 'subject') return 'blue'
  return 'indigo'
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
      setResults((currentResults) => append ? [...currentResults, ...(data.results || [])] : data.results || [])
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

  const loadMoreResults = () => {
    if (!pagination?.hasMore) {
      return
    }
    const nextOffset = pagination.nextOffset ?? pagination.offset + pagination.limit

    void runSearch(activeSearchText || query, { offset: nextOffset, append: true, syncInput: false })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }

  return (
    <Container size="md" py="xl">
      <Stack align="center" mb="xl">
        <Title order={1}>UIUC Smart Course Search</Title>
        <Text c="dimmed">Find courses by difficulty, GenEd, time, and more.</Text>
      </Stack>

      <Group mb="md">
        <TextInput
          aria-label="Course search query"
          placeholder="e.g., easy cs gened, MWF morning 3 credits"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          style={{ flex: 1 }}
          leftSection={<IconSearch size={16} />}
          size="md"
        />
        <Button onClick={handleSearch} size="md" leftSection={<IconSearch size={16} />}>Search</Button>
      </Group>

      {/* Error Message */}
      {error && (
        <Alert role="alert" variant="light" color="red" title="Search failed" icon={<IconAlertCircle />} mb="md">
          {error}
        </Alert>
      )}

      {meta && (
        <Paper p="sm" withBorder bg="gray.0" mb="md">
          <Group justify="space-between" align="center" mb="xs">
            <Text size="sm" fw={600}>Search filters</Text>
            <Button
              size="xs"
              variant="subtle"
              leftSection={<IconAdjustments size={14} />}
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
            <Paper mt="sm" p="sm" withBorder bg="white">
              <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="xs">
                <TextInput
                  label="Subject"
                  placeholder="CS"
                  value={advancedDraft.subject ?? ''}
                  onChange={(event) => setAdvancedDraft((state) => ({ ...state, subject: event.currentTarget.value || undefined }))}
                />
                <TextInput
                  label="Course number"
                  placeholder="225"
                  value={advancedDraft.number ?? ''}
                  onChange={(event) => setAdvancedDraft((state) => ({ ...state, number: event.currentTarget.value || undefined }))}
                />
                <TextInput
                  label="Instructor"
                  placeholder="Fagen"
                  value={advancedDraft.instructor ?? ''}
                  onChange={(event) => setAdvancedDraft((state) => ({ ...state, instructor: event.currentTarget.value || undefined }))}
                />
                <TextInput
                  label="GenEd"
                  placeholder="HUM"
                  value={advancedDraft.gened ?? ''}
                  onChange={(event) => setAdvancedDraft((state) => ({ ...state, gened: event.currentTarget.value || undefined }))}
                />
                <TextInput
                  label="Term"
                  placeholder="spring"
                  value={advancedDraft.term ?? ''}
                  onChange={(event) => setAdvancedDraft((state) => ({ ...state, term: event.currentTarget.value || undefined }))}
                />
                <TextInput
                  label="Year"
                  placeholder="2026"
                  value={advancedDraft.year?.toString() ?? ''}
                  onChange={(event) => {
                    const year = parseInt(event.currentTarget.value, 10)
                    setAdvancedDraft((state) => ({ ...state, year: Number.isNaN(year) ? undefined : year }))
                  }}
                />
                <TextInput
                  label="Credits"
                  placeholder="3"
                  value={advancedDraft.credits?.toString() ?? ''}
                  onChange={(event) => {
                    const credits = parseInt(event.currentTarget.value, 10)
                    setAdvancedDraft((state) => ({ ...state, credits: Number.isNaN(credits) ? undefined : credits }))
                  }}
                />
                <TextInput
                  label="Days"
                  placeholder="MWF"
                  value={advancedDraft.days ?? ''}
                  onChange={(event) => setAdvancedDraft((state) => ({ ...state, days: event.currentTarget.value || undefined }))}
                />
                <TextInput
                  label="Time"
                  placeholder="morning"
                  value={advancedDraft.time ?? ''}
                  onChange={(event) => setAdvancedDraft((state) => ({ ...state, time: event.currentTarget.value || undefined }))}
                />
                <Select
                  label="Delivery"
                  placeholder="Any"
                  value={advancedDraft.online === undefined ? null : String(advancedDraft.online)}
                  data={[
                    { value: 'true', label: 'Online' },
                    { value: 'false', label: 'In person' },
                  ]}
                  clearable
                  onChange={(value) => setAdvancedDraft((state) => ({ ...state, online: value === null ? undefined : value === 'true' }))}
                />
                <Select
                  label="Status"
                  placeholder="Any"
                  value={advancedDraft.status ?? null}
                  data={[
                    { value: 'open', label: 'Open' },
                    { value: 'closed', label: 'Closed' },
                  ]}
                  clearable
                  onChange={(value) => setAdvancedDraft((state) => ({ ...state, status: value ?? undefined }))}
                />
                <Select
                  label="Workload"
                  placeholder="Any"
                  value={advancedDraft.difficulty ?? null}
                  data={[
                    { value: 'easy', label: 'Easier' },
                    { value: 'hard', label: 'Harder' },
                  ]}
                  clearable
                  onChange={(value) => setAdvancedDraft((state) => ({ ...state, difficulty: value === 'easy' || value === 'hard' ? value : undefined }))}
                />
              </SimpleGrid>
              <Group justify="flex-end" mt="sm">
                <Button size="xs" onClick={applyAdvancedSearch}>Apply filters</Button>
              </Group>
            </Paper>
          </Collapse>
        </Paper>
      )}

      {meta && (
        <Box mb="md">
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

      <Box aria-busy={loading}>
        {loading ? (
          <Flex justify="center" py="xl" role="status" aria-live="polite" aria-label="Searching courses">
            <Loader aria-hidden />
          </Flex>
        ) : (
          results.length === 0 && meta ? (
            <Text c="dimmed" ta="center" py="xl" role="status">No courses found matching your criteria.</Text>
          ) : (
            <Stack gap="md">
              {results.map((r) => (
                <Card
                  key={r.id || `${r.subject}-${r.number}-${r.term}-${r.year}`}
                  withBorder
                  padding="sm"
                  component={Link}
                  to={`/course/${r.subject}/${r.number}?term=${r.term}&year=${r.year}`}
                  data-historical={r._historical ? 'true' : undefined}
                  style={{
                    textDecoration: 'none',
                    color: 'inherit',
                    cursor: 'pointer',
                    backgroundColor: r._historical ? 'var(--mantine-color-gray-0)' : undefined,
                    borderColor: r._historical ? 'var(--mantine-color-gray-4)' : undefined,
                    boxShadow: r._historical ? 'none' : undefined,
                    opacity: r._historical ? 0.72 : 1,
                    filter: r._historical ? 'grayscale(0.25)' : undefined,
                  }}
                  shadow="sm"
                >
                  <Flex justify="space-between" align="flex-start" gap="sm" wrap="wrap">
                    <Box style={{ minWidth: 0, flex: '1 1 18rem' }}>
                      <Text fw={700} c={r._historical ? 'dimmed' : undefined}>{r.subject} {r.number}: {r.title}</Text>
                      <Group gap="xs" mt={4}>
                        <Text size="xs" fw={r._historical ? 600 : undefined} c={r._historical ? 'gray.7' : 'dimmed'}>
                          {formatTermLabel(r.term, r.year)}
                        </Text>
                        {r._historical && (
                          <Badge color="gray" variant="filled" size="xs" tt="none">
                            Historical term
                          </Badge>
                        )}
                        <Text size="xs" c={r._historical ? 'gray.7' : 'dimmed'}>
                          {r.credit_hours} credits
                        </Text>
                        {r.primary_instructor && (
                          <Text size="xs" c="dimmed" style={{ borderLeft: '1px solid var(--mantine-color-gray-3)', paddingLeft: '8px' }}>
                            {r.primary_instructor}
                          </Text>
                        )}
                        {r.gened && <Badge variant="outline" size="xs">{r.gened}</Badge>}
                      </Group>
                      {r.match_evidence && r.match_evidence.length > 0 && (
                        <Group gap={4} mt={6}>
                          {r.match_evidence.slice(0, 5).map((evidence) => (
                            <Badge
                              key={`${evidence.kind}-${evidence.label}`}
                              size="xs"
                              variant={evidence.weight === 'hard' ? 'filled' : 'light'}
                              color={getEvidenceColor(evidence)}
                              tt="none"
                              title={evidence.label}
                            >
                              {evidence.label}
                            </Badge>
                          ))}
                        </Group>
                      )}
                      {renderScoreBadges(r)}
                    </Box>
                    {typeof r._score === 'number' && (
                      <Badge
                        variant={r._historical ? 'outline' : 'light'}
                        color={r._historical ? 'gray' : undefined}
                        style={{ flexShrink: 0 }}
                      >
                        {getRelevanceLabel(r._score)}
                      </Badge>
                    )}
                  </Flex>
                  <Text size="sm" mt="xs" lineClamp={3} c={r._historical ? 'gray.6' : 'dimmed'}>
                    {r.description}
                  </Text>
                </Card>
              ))}
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
        )}
      </Box>
    </Container>
  )
}
