import { useEffect, useState } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { AlertCircleIcon, ExternalLinkIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PageContainer } from '@/components/PageContainer'
import { Scorecard } from '../components/Scorecard'
import { SectionsTable } from '../components/SectionsTable'
import { FeedbackButton } from '../components/FeedbackButton'
import { api } from '../lib/api-client'
import type {
  CourseDetailDto,
  CourseDetailResponseDto,
  CourseGenedDto,
} from '@uiuc-course-search/query-types'

function genedLabel(gened: CourseGenedDto): string {
  const category = gened.categoryName ?? gened.categoryId
  if (gened.attributeName) return `${category}: ${gened.attributeName}`
  if (gened.attributeCode) return `${category}: ${gened.attributeCode}`
  return category
}

function detailRows(course: CourseDetailDto): Array<{ label: string; value: string }> {
  return [
    { label: 'Course information', value: course.registration.courseInfo },
    { label: 'Degree attributes', value: course.registration.degreeAttributes },
    { label: 'Schedule information', value: course.registration.classScheduleInfo },
    { label: 'Date range', value: course.registration.dateRangeText },
    { label: 'Registration notes', value: course.registration.registrationNotes },
    { label: 'Approval code', value: course.registration.approvalCode },
  ].filter((item): item is { label: string; value: string } =>
    Boolean(item.value)
  )
}

export function CoursePage() {
  const { subject, number } = useParams()
  const [searchParams] = useSearchParams()
  const term = searchParams.get('term') || undefined
  const year = searchParams.get('year')
    ? parseInt(searchParams.get('year')!)
    : undefined

  const [detail, setDetail] = useState<CourseDetailResponseDto | null>(null)
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
        setDetail(data)
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
          className="grid gap-6 md:grid-cols-[17rem_minmax(0,1fr)] xl:grid-cols-[18rem_minmax(0,1fr)] 2xl:grid-cols-[20rem_minmax(0,1fr)]"
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

  if (error || !detail) {
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

  const course = detail.course
  const details = detailRows(course)
  const genedBadges = course.requirements.map(genedLabel)

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
          {genedBadges.map((label) => (
            <Badge key={label} variant="outline">
              {label}
            </Badge>
          ))}
          {course.links.courseExplorerUrl && (
            <Button asChild variant="outline" size="xs">
              <a
                href={course.links.courseExplorerUrl}
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
          {course.creditHours} credit hours / {course.term} {course.year}
          {course.primaryInstructor && ` / ${course.primaryInstructor}`}
        </p>
      </div>

      <div className="grid gap-8 md:grid-cols-[17rem_minmax(0,1fr)] xl:grid-cols-[18rem_minmax(0,1fr)] 2xl:grid-cols-[20rem_minmax(0,1fr)]">
        <aside className="min-w-0 md:sticky md:top-24 md:self-start">
          <div className="flex flex-col gap-3">
            <Scorecard
              qualityScore={course.metrics.qualityScore}
              workloadScore={course.metrics.workloadScore}
              avgGpa={course.metrics.avgGpa}
              medianGpa={course.metrics.medianGpa}
              gpaSampleSize={course.metrics.gpaSampleSize}
              primaryInstructorRmp={course.metrics.primaryInstructorRating}
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
                  qualityScore: course.metrics.qualityScore,
                  workloadScore: course.metrics.workloadScore,
                  avgGpa: course.metrics.avgGpa,
                  primaryInstructorRmp: course.metrics.primaryInstructorRating,
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

          {details.length > 0 && (
            <Card>
              <CardHeader>
                <h2 className="text-xl leading-snug font-semibold">
                  Registration details
                </h2>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-4 lg:grid-cols-2">
                  {details.map((item) => (
                    <div key={item.label} className="flex flex-col gap-1">
                      <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                        {item.label}
                      </dt>
                      <dd className="text-sm leading-6">{item.value}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          )}

          <section className="flex min-w-0 flex-col gap-3">
            <h2 className="text-xl font-semibold">Sections and instructors</h2>
            <Card>
              <CardContent className="p-0">
                <div
                  aria-label="Sections table with horizontal scrolling"
                  className="relative overflow-x-auto overflow-y-hidden"
                >
                  <SectionsTable
                    sections={course.sections || []}
                    instructorLinks={course.instructorLinks}
                    courseExplorerUrl={course.links.courseExplorerUrl}
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
