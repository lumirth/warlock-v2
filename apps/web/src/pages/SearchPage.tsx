import { useState, useRef } from 'react'
import { Alert, Container, Title, TextInput, Button, Group, Badge, Paper, Text, Stack, Card, Flex, Loader, Box } from '@mantine/core'
import { IconAlertCircle, IconSearch } from '@tabler/icons-react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api-client'
import type { CourseDto, Hint, MatchEvidence, SearchMetaDto } from '@uiuc-course-search/query-types'
import { getLetterGrade } from '../utils/grading'
import { DIFFICULTY } from '../config/constants'

function formatHintValue(value: Hint['value']): string {
  if (typeof value === 'object' && value !== null) {
    if ('subject' in value && 'number' in value) {
      return `${value.subject} ${value.number}`
    }
    return JSON.stringify(value)
  }
  return String(value)
}

function getHintColor(type: string): string {
  const colors: Record<string, string> = {
    courseCode: 'blue',
    subject: 'violet',
    instructor: 'teal',
    gened: 'yellow',
    days: 'red',
    time: 'pink',
    level: 'indigo',
    credits: 'cyan',
    difficulty: 'orange',
    online: 'cyan',
    status: 'lime',
    crn: 'grape',
  }
  return colors[type] || 'gray'
}

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
          Quality {getLetterGrade(qualityScore)} ({qualityScore.toFixed(0)})
        </Badge>
      )}
      {hasDifficulty && (
        <Badge size="xs" variant="light" color={getDifficultyColor(difficultyScore)} tt="none">
          Difficulty {getDifficultyLabel(difficultyScore)}
        </Badge>
      )}
      {hasRating && (
        <Badge size="xs" variant="light" color={primaryInstructorRmp >= 3.5 ? 'teal' : 'orange'} tt="none">
          Rating {primaryInstructorRmp.toFixed(1)}
        </Badge>
      )}
      {hasGpa && (
        <Badge
          size="xs"
          variant="light"
          color="cyan"
          tt="none"
          title={typeof course.gpa_sample_size === 'number' ? `GPA sample size ${course.gpa_sample_size}` : undefined}
        >
          GPA {avgGpa.toFixed(2)}
        </Badge>
      )}
    </Group>
  )
}

export function SearchPage() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CourseDto[]>([])
  const [meta, setMeta] = useState<SearchMetaDto | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Ref to hold the current AbortController
  const searchController = useRef<AbortController | null>(null)

  const handleSearch = async () => {
    if (!query.trim()) return

    // Cancel previous request if it exists
    if (searchController.current) {
      searchController.current.abort()
    }
    // Create new controller for this request
    const controller = new AbortController()
    searchController.current = controller

    setLoading(true)
    setMeta(null)
    setResults([])
    setError(null)

    try {
      const data = await api.search(query, controller.signal)
      setResults(data.results || [])
      setMeta(data.meta || null)
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'An unknown error occurred')
    } finally {
      // Only turn off loading if this is still the active request
      if (searchController.current === controller) {
        setLoading(false)
        searchController.current = null
      }
    }
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

      {/* Show extraction results after search */}
      {meta && (
        <Paper p="sm" withBorder bg="gray.0" mb="md">
          {/* Hint chips */}
          {meta.extraction.hints.length > 0 && (
            <Group gap="xs" mb="xs">
              {meta.extraction.hints.map((hint, i) => (
                <Badge
                  key={`${hint.type}-${i}`}
                  color={getHintColor(hint.type)}
                  title={`Source: ${hint.metadata.source}, Confidence: ${typeof hint.metadata.confidence === 'number' ? (hint.metadata.confidence * 100).toFixed(0) : '?' }%`}
                >
                  {hint.type}: {formatHintValue(hint.value)}
                </Badge>
              ))}
            </Group>
          )}

          {/* Residual query */}
          {meta.query.residual && (
            <Text size="xs" c="dimmed">
              Semantic search: "{meta.query.residual}"
            </Text>
          )}

          {/* Ambiguities */}
          {meta.ambiguities && meta.ambiguities.length > 0 && (
            <Stack gap="xs" mt="xs">
              {meta.ambiguities.map((amb, i) => (
                <Text key={i} size="xs" c="dimmed">
                  "{amb.term}" interpreted as <strong>{amb.chosen.label}</strong>
                  {amb.alternatives.length > 0 && (
                    <span> (could also be: {amb.alternatives.map(a => a.label).join(', ')})</span>
                  )}
                </Text>
              ))}
            </Stack>
          )}

          {/* Timing */}
          <Text size="xs" c="dimmed" mt="xs">
            Extraction: {meta.timing.extraction_ms}ms | Search: {meta.timing.search_ms}ms | Total: {meta.timing.total_ms}ms
          </Text>
        </Paper>
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
                  style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
                  shadow="sm"
                >
                  <Flex justify="space-between" align="flex-start" gap="sm" wrap="wrap">
                    <Box style={{ minWidth: 0, flex: '1 1 18rem' }}>
                      <Text fw={700}>{r.subject} {r.number}: {r.title}</Text>
                      <Group gap="xs" mt={4}>
                        <Text size="xs" c="dimmed">
                          {r.term} {r.year} | {r.credit_hours} credits
                        </Text>
                        {r.primary_instructor && (
                          <Text size="xs" c="dimmed" style={{ borderLeft: '1px solid var(--mantine-color-gray-3)', paddingLeft: '8px' }}>
                            {r.primary_instructor}
                          </Text>
                        )}
                        {r._historical && <Badge color="yellow" size="xs">historical</Badge>}
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
                      <Badge variant="light" style={{ flexShrink: 0 }}>Match {r._score.toFixed(2)}</Badge>
                    )}
                  </Flex>
                  <Text size="sm" mt="xs" lineClamp={3} c="dimmed">
                    {r.description}
                  </Text>
                </Card>
              ))}
            </Stack>
          )
        )}
      </Box>
    </Container>
  )
}
