import { useEffect, useState } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { Container, Title, Text, Button, Loader, Flex, Grid, Stack, Badge, Group, Paper, Alert, ScrollArea } from '@mantine/core'
import { IconAlertCircle, IconExternalLink } from '@tabler/icons-react'
import { Scorecard } from '../components/Scorecard'
import { SectionsTable } from '../components/SectionsTable'
import { FeedbackButton } from '../components/FeedbackButton'
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
        <Flex justify="center" align="center" mih="50vh" role="status" aria-live="polite" aria-label="Loading course">
          <Loader size="lg" aria-hidden />
        </Flex>
      </Container>
    )
  }

  if (error || !course) {
    return (
      <Container size="lg" py="xl">
        <Button component={Link} to="/" variant="subtle" mb="md">← Back to Search</Button>
        <Alert role="alert" variant="light" color="red" title="Error loading course" icon={<IconAlertCircle />}>
          {error || 'Course not found'}
        </Alert>
      </Container>
    )
  }

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
            {course.course_explorer_url && (
              <Button
                component="a"
                href={course.course_explorer_url}
                target="_blank"
                rel="noreferrer"
                variant="light"
                size="xs"
                leftSection={<IconExternalLink size={14} />}
              >
                Course Explorer
              </Button>
            )}
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
              avgGpa={course.avg_gpa}
              gpaSampleSize={course.gpa_sample_size}
              primaryInstructorRmp={course.primary_instructor_rmp}
            />
            <FeedbackButton
              buttonLabel="Score feedback"
              page="course"
              kind="score"
              issue="wrong_score"
              context={{
                courseId: course.id,
                subject: course.subject,
                number: course.number,
                term: course.term,
                year: course.year,
                metadata: {
                  qualityScore: course.quality_score,
                  difficultyScore: course.difficulty_score,
                  avgGpa: course.avg_gpa,
                  primaryInstructorRmp: course.primary_instructor_rmp,
                },
              }}
            />
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
                    courseExplorerUrl={course.course_explorer_url}
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
