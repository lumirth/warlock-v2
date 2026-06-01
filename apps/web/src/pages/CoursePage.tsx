import { useEffect, useState } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { Container, Title, Text, Button, Loader, Flex, Grid, Stack, Badge, Group, Paper, Alert, ScrollArea } from '@mantine/core'
import { IconAlertCircle } from '@tabler/icons-react'
import { Scorecard } from '../components/Scorecard'
import { QuadrantChart } from '../components/QuadrantChart'
import { SectionsTable } from '../components/SectionsTable'
import { api } from '../lib/api-client'
import type { CourseDto } from '@uiuc-course-search/query-types'

export function CoursePage() {
  const { subject, number } = useParams()
  const [searchParams] = useSearchParams()
  const term = searchParams.get('term') || undefined
  const year = searchParams.get('year') ? parseInt(searchParams.get('year')!) : undefined

  const [course, setCourse] = useState<CourseDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function fetchCourse() {
      if (!subject || !number) return
      setLoading(true)
      setError(null)

      try {
        const data = await api.getCourse(subject, number, term, year, controller.signal)
        setCourse(data)
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return
        console.error(err)
        setError(err instanceof Error ? err.message : 'Failed to load course')
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      }
    }

    fetchCourse()

    return () => {
      controller.abort()
    }
  }, [subject, number, term, year])

  if (loading) {
    return (
      <Container size="lg" py="xl">
        <Flex justify="center" align="center" mih="50vh">
          <Loader size="lg" />
        </Flex>
      </Container>
    )
  }

  if (error || !course) {
    return (
      <Container size="lg" py="xl">
        <Button component={Link} to="/" variant="subtle" mb="md">← Back to Search</Button>
        <Alert variant="light" color="red" title="Error loading course" icon={<IconAlertCircle />}>
          {error || 'Course not found'}
        </Alert>
      </Container>
    )
  }

  // Only show chart if we have valid scores
  const hasScores = course.quality_score !== null && course.difficulty_score !== null

  return (
    <Container size="lg" py="xl">
      <Button component={Link} to="/" variant="subtle" mb="md">
        ← Back to Search
      </Button>

      {/* Header Section */}
      <Stack gap="xs" mb="xl">
        <Group align="center">
            <Title order={1} fz={36}>{course.subject} {course.number}: {course.title}</Title>
            {course.gened && <Badge size="lg" variant="gradient" gradient={{ from: 'indigo', to: 'cyan' }}>{course.gened}</Badge>}
        </Group>
        <Text size="lg" c="dimmed">
          {course.credit_hours} Credit Hours • {course.term} {course.year}
          {course.primary_instructor && ` • ${course.primary_instructor}`}
        </Text>
      </Stack>

      <Grid gutter="xl">
        {/* Left Column: Stats & Viz */}
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Stack gap="md">
            <Scorecard
              qualityScore={course.quality_score}
              difficultyScore={course.difficulty_score}
            />

            {hasScores && (
              <Paper p="md" withBorder radius="md">
                <QuadrantChart
                  currentCourse={{
                    code: `${course.subject} ${course.number}`,
                    quality: course.quality_score,
                    difficulty: course.difficulty_score
                  }}
                  contextCourses={[]} // TODO: Fetch department context
                />
              </Paper>
            )}
          </Stack>
        </Grid.Col>

        {/* Right Column: Details & Sections */}
        <Grid.Col span={{ base: 12, md: 8 }}>
          <Stack gap="xl">
            {/* Description */}
            <Paper p="md" bg="gray.0">
              <Title order={2} size="h4" mb="xs">Description</Title>
              <Text lh={1.6}>{course.description}</Text>
            </Paper>

            {/* Sections Table */}
            <div>
              <Title order={2} size="h3" mb="md">Sections & Instructors</Title>
              <Paper withBorder radius="md">
                <ScrollArea type="auto" offsetScrollbars>
                  <SectionsTable
                    sections={course.sections || []}
                    instructorLinks={course.instructor_links}
                  />
                </ScrollArea>
              </Paper>
            </div>
          </Stack>
        </Grid.Col>
      </Grid>
    </Container>
  )
}
