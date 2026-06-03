import { useEffect, useState } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { AlertCircleIcon, ExternalLinkIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PageContainer } from '@/components/PageContainer'
import { Scorecard } from '../components/Scorecard'
import { SectionsTable } from '../components/SectionsTable'
import { FeedbackButton } from '../components/FeedbackButton'
import { api } from '../lib/api-client'
import type { CourseDto } from '@uiuc-course-search/query-types'

export function CoursePage() {
  const { subject, number } = useParams()
  const [searchParams] = useSearchParams()
  const term = searchParams.get('term') || undefined
  const year = searchParams.get('year')
    ? parseInt(searchParams.get('year')!)
    : undefined

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
        const data = await api.getCourse(
          subject,
          number,
          term,
          year,
          controller.signal
        )
        setCourse(data)
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return
        setError(
          'Give it another moment, or return to search and try the course again.'
        )
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
      <PageContainer className="py-8">
        <div
          role="status"
          aria-live="polite"
          aria-label="Loading course"
          className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)] 2xl:grid-cols-[20rem_minmax(0,1fr)]"
        >
          <div className="flex flex-col gap-3">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-48 w-full" />
          </div>
          <div className="flex flex-col gap-4">
            <Skeleton className="h-10 w-3/4" />
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-36 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        </div>
      </PageContainer>
    )
  }

  if (error || !course) {
    return (
      <PageContainer className="py-8">
        <Button asChild variant="ghost" className="mb-4">
          <Link to="/">Back to search</Link>
        </Button>
        <Alert variant="destructive">
          <AlertCircleIcon aria-hidden />
          <AlertTitle>That course did not load</AlertTitle>
          <AlertDescription>
            {error ||
              'Return to search and try the course again with a broader term.'}
          </AlertDescription>
        </Alert>
      </PageContainer>
    )
  }

  return (
    <PageContainer className="py-8">
      <Button asChild variant="ghost" className="mb-4">
        <Link to="/">Back to search</Link>
      </Button>

      <div className="mb-8 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl leading-tight font-semibold">
            {course.subject} {course.number}: {course.title}
          </h1>
          {course.gened && (
            <span className="text-muted-foreground text-sm font-semibold">
              {course.gened}
            </span>
          )}
          {course.course_explorer_url && (
            <Button asChild variant="outline" size="xs">
              <a
                href={course.course_explorer_url}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLinkIcon data-icon="inline-start" aria-hidden />
                Course Explorer
              </a>
            </Button>
          )}
        </div>
        <p className="text-muted-foreground text-lg">
          {course.credit_hours} credit hours / {course.term} {course.year}
          {course.primary_instructor && ` / ${course.primary_instructor}`}
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[18rem_minmax(0,1fr)] 2xl:grid-cols-[20rem_minmax(0,1fr)]">
        <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <div className="flex flex-col gap-3">
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
          </div>
        </aside>

        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <h2 className="text-xl leading-snug font-semibold">
                Description
              </h2>
            </CardHeader>
            <CardContent>
              <p className="leading-7">{course.description}</p>
            </CardContent>
          </Card>

          <section className="flex min-w-0 flex-col gap-3">
            <h2 className="text-xl font-semibold">Sections and instructors</h2>
            <Card>
              <CardContent className="p-0">
                <div
                  aria-label="Sections table with horizontal scrolling"
                  className="relative overflow-hidden"
                >
                  <SectionsTable
                    sections={course.sections || []}
                    instructorLinks={course.instructor_links}
                    courseExplorerUrl={course.course_explorer_url}
                  />
                </div>
              </CardContent>
            </Card>
          </section>
        </div>
      </div>
    </PageContainer>
  )
}
