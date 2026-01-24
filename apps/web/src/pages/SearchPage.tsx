import { useState, useRef } from 'react'
import { Container, Title, TextInput, Button, Group, Badge, Paper, Text, Stack, Card, Flex, Loader, Box } from '@mantine/core'
import { IconSearch } from '@tabler/icons-react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api-client'
import type { SearchMeta, Course } from '../lib/api-types'

function formatHintValue(value: string | number | boolean | { subject?: string; number?: string }): string {
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

export function SearchPage() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Course[]>([])
  const [meta, setMeta] = useState<SearchMeta | null>(null)
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
    searchController.current = new AbortController()

    setLoading(true)
    setMeta(null)
    setError(null)

    try {
      const data = await api.search(query, searchController.current.signal)
      setResults(data.results || [])
      setMeta(data.meta || null)
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return
      console.error('Search failed:', err)
      setError(err instanceof Error ? err.message : 'An unknown error occurred')
    } finally {
      // Only turn off loading if this is still the active request
      if (searchController.current && !searchController.current.signal.aborted) {
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
          placeholder="e.g., easy cs gened, MWF morning 3 credits"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          style={{ flex: 1 }}
          leftSection={<IconSearch size={16} />}
          size="md"
        />
        <Button onClick={handleSearch} size="md">Search</Button>
      </Group>

      {/* Error Message */}
      {error && (
        <Paper p="sm" withBorder bg="red.0" c="red.9" mb="md">
            <Text fw={500}>Error: {error}</Text>
        </Paper>
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
                  title={`Source: ${hint.metadata.source}, Confidence: ${(hint.metadata.confidence * 100).toFixed(0)}%`}
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

      <Box>
        {loading ? (
          <Flex justify="center" py="xl">
            <Loader />
          </Flex>
        ) : (
          results.length === 0 && meta ? (
            <Text c="dimmed" ta="center" py="xl">No courses found matching your criteria.</Text>
          ) : (
            <Stack gap="md">
              {results.map((r) => (
                <Card
                  key={r.id || `${r.subject}-${r.number}-${r.term}-${r.year}`}
                  withBorder
                  padding="sm"
                  component={Link}
                  to={`/course/${r.subject}/${r.number}`}
                  style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
                  shadow="sm"
                >
                  <Flex justify="space-between" align="flex-start">
                    <div>
                      <Text fw={700}>{r.subject} {r.number}: {r.title}</Text>
                      <Group gap="xs" mt={4}>
                        <Text size="xs" c="dimmed">
                          {r.term} {r.year} | {r.credit_hours} credits
                        </Text>
                        {r._historical && <Badge color="yellow" size="xs">historical</Badge>}
                        {r.gened && <Badge variant="outline" size="xs">{r.gened}</Badge>}
                      </Group>
                    </div>
                    {r._score !== undefined && (
                        <Badge variant="light">Match: {r._score.toFixed(2)}</Badge>
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
