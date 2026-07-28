import { useEffect, useState } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  ExternalLinkIcon,
  InfoIcon,
} from 'lucide-react'
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
import {
  courseRequirementLabel,
  type CourseDetailCacheDto,
  type CourseDetailDto,
  type CourseDetailResponseDto,
} from '@uiuc-course-search/query-types'

type CourseLocationState = {
  fromSearch?: boolean
  returnTo?: string
}

function registrationRows(
  course: CourseDetailDto
): Array<{ label: string; value: string }> {
  return [
    {
      label: 'Registration notes',
      value: course.registration.registrationNotes,
    },
    { label: 'Approval code', value: course.registration.approvalCode },
    {
      label: 'Schedule information',
      value: course.scheduleNotes.classScheduleInfo,
    },
    { label: 'Date range', value: course.scheduleNotes.dateRangeText },
    { label: 'Course information', value: course.catalog.courseInfo },
    { label: 'Degree attributes', value: course.catalog.degreeAttributes },
  ].filter((item): item is { label: string; value: string } =>
    Boolean(item.value)
  )
}

export function CoursePage() {
  const { subject, number } = useParams()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const term = searchParams.get('term') || undefined
  const parsedYear = Number(searchParams.get('year'))
  const year =
    Number.isInteger(parsedYear) && parsedYear > 0 ? parsedYear : undefined
  const returnTo = safeReturnPath(
    (location.state as CourseLocationState | null)?.returnTo
  )

  const [detail, setDetail] = useState<CourseDetailResponseDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [requestAttempt, setRequestAttempt] = useState(0)

  useEffect(() => {
    document.title = detail
      ? `${detail.course.subject} ${detail.course.number}: ${detail.course.title} · UIUC Course Search`
      : `${subject ?? 'Course'} ${number ?? ''} · UIUC Course Search`.trim()
  }, [detail, number, subject])

  useEffect(() => {
    const controller = new AbortController()

    async function fetchCourse() {
      if (!subject || !number) {
        setError('The course address is incomplete.')
        setLoading(false)
        return
      }
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

    void fetchCourse()
    return () => controller.abort()
  }, [subject, number, term, year, requestAttempt])

  if (loading) {
    return (
      <PageContainer className="py-8">
        <div
          role="status"
          aria-live="polite"
          aria-label="Loading course"
          className="flex flex-col gap-5"
        >
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-10 w-3/4" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      </PageContainer>
    )
  }

  if (error || !detail) {
    return (
      <PageContainer className="py-8">
        <BackToSearch returnTo={returnTo} />
        <Alert variant="destructive" className="mt-4">
          <AlertCircleIcon aria-hidden />
          <AlertTitle>That course did not load</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <p>
              {error ||
                'Return to search and try the course again with a broader term.'}
            </p>
            {subject && number ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setRequestAttempt((attempt) => attempt + 1)}
              >
                Try loading this course again
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      </PageContainer>
    )
  }

  const course = detail.course
  const details = registrationRows(course)
  const requirementBadges = course.requirements.map(courseRequirementLabel)

  return (
    <PageContainer className="py-6 sm:py-8">
      <BackToSearch returnTo={returnTo} />

      <header className="mt-5 flex flex-col gap-4 border-b pb-6">
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm font-medium">
            {formatTerm(course.term)} {course.year}
          </p>
          <h1 className="max-w-5xl text-3xl leading-tight font-semibold">
            {course.subject} {course.number}: {course.title}
          </h1>
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
            <span>
              {formatCredits(course.creditHours, course.creditHoursText)}
            </span>
            {course.primaryInstructor ? (
              <span>{course.primaryInstructor}</span>
            ) : null}
            {requirementBadges.map((label) => (
              <Badge key={label} variant="outline">
                {label}
              </Badge>
            ))}
          </div>
        </div>
        {course.links.courseExplorerUrl ? (
          <Button asChild className="w-fit">
            <a
              href={course.links.courseExplorerUrl}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLinkIcon data-icon="inline-start" aria-hidden />
              View official course listing
            </a>
          </Button>
        ) : null}
      </header>

      <FreshnessNotice cache={detail.cache} />

      <div className="mt-6 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {details.length > 0 ? (
            <section aria-labelledby="registration-heading">
              <Card>
                <CardHeader>
                  <h2
                    id="registration-heading"
                    className="text-xl leading-snug font-semibold"
                  >
                    Registration and catalog notes
                  </h2>
                </CardHeader>
                <CardContent>
                  <dl className="grid gap-4 md:grid-cols-2">
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
            </section>
          ) : null}

          <section aria-labelledby="sections-heading" className="min-w-0">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="sections-heading" className="text-xl font-semibold">
                Sections and instructors
              </h2>
              <p className="text-muted-foreground text-xs">
                Verify status in the official listing before registering.
              </p>
            </div>
            <Card>
              <CardContent className="p-0">
                <SectionsTable sections={course.sections ?? []} />
              </CardContent>
            </Card>
          </section>

          <section aria-labelledby="description-heading">
            <Card>
              <CardHeader>
                <h2
                  id="description-heading"
                  className="text-xl leading-snug font-semibold"
                >
                  Description
                </h2>
              </CardHeader>
              <CardContent>
                <p className="leading-7">
                  {course.description ||
                    'No catalog description is available for this offering.'}
                </p>
              </CardContent>
            </Card>
          </section>
        </div>

        <aside className="min-w-0 lg:sticky lg:top-24">
          <div className="flex flex-col gap-3">
            <Scorecard
              qualityScore={course.metrics.qualityScore}
              instructorDifficultyScore={
                course.metrics.instructorDifficultyScore
              }
              avgGpa={course.metrics.avgGpa}
              medianGpa={course.metrics.medianGpa}
              gpaSampleSize={course.metrics.gpaSampleSize}
              primaryInstructorRmp={course.metrics.primaryInstructorRating}
            />
            <FeedbackButton
              buttonLabel="Report a signal issue"
              page="course"
              kind="score"
              issue="wrong_score"
              fullWidth
              buttonVariant="outline"
              expectedPlaceholder="What course signal did you expect?"
              messagePlaceholder="What looks wrong, and what source should we check?"
              context={{
                courseId: course.id,
                subject: course.subject,
                number: course.number,
                term: course.term,
                year: course.year,
                metadata: {
                  qualityScore: course.metrics.qualityScore,
                  instructorDifficultyScore:
                    course.metrics.instructorDifficultyScore,
                  avgGpa: course.metrics.avgGpa,
                  primaryInstructorRmp: course.metrics.primaryInstructorRating,
                },
              }}
            />
          </div>
        </aside>
      </div>
    </PageContainer>
  )
}

function BackToSearch({ returnTo }: { returnTo: string }) {
  return (
    <Button asChild variant="ghost" className="-ml-2">
      <Link to={returnTo}>
        <ArrowLeftIcon data-icon="inline-start" aria-hidden />
        Back to search results
      </Link>
    </Button>
  )
}

function FreshnessNotice({ cache }: { cache?: CourseDetailCacheDto }) {
  const checkedAt = cache?.fetchedAt ? formatTimestamp(cache.fetchedAt) : null
  const status = termStatusLabel(cache?.termStatus)

  if (cache?.stale) {
    return (
      <Alert className="border-warning/50 bg-warning/5 mt-5">
        <AlertCircleIcon className="text-warning" aria-hidden />
        <AlertTitle>Saved course data may be out of date</AlertTitle>
        <AlertDescription>
          The official source could not be refreshed.{' '}
          {checkedAt ? `This snapshot was fetched ${checkedAt}. ` : null}
          Verify section status in Course Explorer before registering.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="bg-muted/60 text-muted-foreground mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-3 py-2 text-xs">
      <InfoIcon className="size-4" aria-hidden />
      <span>
        {checkedAt
          ? `Official catalog snapshot fetched ${checkedAt}.`
          : 'Snapshot time was not reported; verify time-sensitive details officially.'}
      </span>
      {status ? <Badge variant="outline">{status}</Badge> : null}
    </div>
  )
}

function safeReturnPath(value: string | undefined): string {
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/'
}

function formatCredits(
  exact: number | null,
  officialText?: string | null
): string {
  const text = officialText?.trim()
  if (text) {
    return /\b(?:credits?|hours?|hrs?)\b/i.test(text)
      ? text
      : `${text} ${text === '1' ? 'credit hour' : 'credit hours'}`
  }
  if (typeof exact !== 'number') return 'Credit hours not listed'
  return `${exact} ${exact === 1 ? 'credit hour' : 'credit hours'}`
}

function formatTerm(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1).toLowerCase()}`
}

function formatTimestamp(timestampSeconds: number): string {
  const date = new Date(timestampSeconds * 1000)
  if (Number.isNaN(date.getTime())) return 'at an unknown time'
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function termStatusLabel(value: string | undefined): string | null {
  if (value === 'registrable') return 'Registration open'
  if (value === 'active') return 'Active term'
  if (value === 'historical') return 'Historical term'
  return value ? formatTerm(value) : null
}
