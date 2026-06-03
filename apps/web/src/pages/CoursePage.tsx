import { useEffect, useState } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { Box, Container, Title, Text, Button, Loader, Flex, Grid, Stack, Group, Paper, Alert, ScrollArea } from '@mantine/core'
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
      <Container size="xl" py="xl">
        <Flex justify="center" align="center" mih="50vh" role="status" aria-live="polite" aria-label="Loading course">
          <Loader size="lg" aria-hidden />
        </Flex>
      </Container>
    )
  }

  if (error || !course) {
    return (
      <Container size="xl" py="xl">
        <Button component={Link} to="/" variant="subtle" mb="md">Back to search</Button>
        <Alert role="alert" variant="light" color="red" title="Error loading course" icon={<IconAlertCircle />}>
          {error || 'Course not found'}
        </Alert>
      </Container>
    )
  }

  return (
    <Container size="xl" py="xl">
      <Button component={Link} to="/" variant="subtle" mb="md">
        Back to search
      </Button>

      <Stack gap="xs" mb="xl">
        <Group align="center">
          <Title order={1} fz={30}>{course.subject} {course.number}: {course.title}</Title>
          {course.gened && <Text size="sm" fw={600} c="dimmed">{course.gened}</Text>}
          {course.course_explorer_url && (
            <Button
              component="a"
              href={course.course_explorer_url}
              target="_blank"
              rel="noreferrer"
              variant="outline"
              size="xs"
              leftSection={<IconExternalLink size={14} />}
            >
              Course Explorer
            </Button>
          )}
        </Group>
        <Text size="lg" c="dimmed">
          {course.credit_hours} credit hours / {course.term} {course.year}
          {course.primary_instructor && ` / ${course.primary_instructor}`}
        </Text>
      </Stack>

      <Grid gutter="xl">
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Stack gap="sm" className="course-sidebar">
            <Scorecard
              qualityScore={course.quality_score}
              difficultyScore={course.difficulty_score}
              avgGpa={course.avg_gpa}
              gpaSampleSize={course.gpa_sample_size}
              primaryInstructorRmp={course.primary_instructor_rmp}
            />
            <Box className="course-feedback-action">
              <FeedbackButton
                buttonLabel="Score feedback"
                page="course"
                kind="score"
                issue="wrong_score"
                fullWidth
                buttonVariant="default"
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
            </Box>
          </Stack>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 8 }}>
          <Stack gap="xl">
            <Paper p="md" withBorder bg="stone.0">
              <Title order={2} size="h4" mb="xs">Description</Title>
              <Text lh={1.6}>{course.description}</Text>
            </Paper>

            <div>
              <Title order={2} size="h3" mb="md">Sections and instructors</Title>
              <Paper
                withBorder
                radius="md"
                shadow="none"
                className="sections-table-shell"
                style={{ position: 'relative', overflow: 'hidden' }}
              >
                <ScrollArea type="always" offsetScrollbars aria-label="Sections table with horizontal scrolling">
                  <SectionsTable
                    sections={course.sections || []}
                    instructorLinks={course.instructor_links}
                    courseExplorerUrl={course.course_explorer_url}
                  />
                </ScrollArea>
                <Box
                  aria-hidden
                  className="sections-table-scroll-cue"
                  style={{
                    position: 'absolute',
                    top: 0,
                    right: 0,
                    bottom: 14,
                    width: 28,
                    pointerEvents: 'none',
                  }}
                />
              </Paper>
            </div>
          </Stack>
        </Grid.Col>
      </Grid>
    </Container>
  )
}
