import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { AlertCircleIcon, ArrowLeftIcon, ExternalLinkIcon } from 'lucide-react'
import type { CourseDetailDto } from '@uiuc-course-search/query-types'
import { courseRequirementLabel } from '@uiuc-course-search/query-types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PageContainer } from '@/components/PageContainer'
import { FeedbackButton } from '../components/FeedbackButton'
import { Scorecard } from '../components/Scorecard'
import { SectionsTable } from '../components/SectionsTable'
import { api } from '../lib/api-client'
import { formatCredits, formatTermLabel } from './search/search-result-model'

function useCourse(subject?: string, number?: string, term?: string, year?: number, attempt = 0) {
  const key = `${subject}/${number}/${term}/${year}/${attempt}`
  const [state, setState] = useState<{ key?: string; course?: CourseDetailDto; error?: string }>({})
  useEffect(() => {
    if (!subject || !number) return
    const controller = new AbortController()
    api.getCourse(subject, number, term, year, controller.signal)
      .then(({ course }) => !controller.signal.aborted && setState({ key, course }))
      .catch((error: unknown) => {
        if ((error as Error)?.name !== 'AbortError') setState({
          key,
          error: 'Give it another moment, or return to search and try the course again.',
        })
      })
    return () => controller.abort()
  }, [subject, number, term, year, key])
  if (!subject || !number) return { loading: false, error: 'The course address is incomplete.' }
  return state.key === key ? { ...state, loading: false } : { loading: true }
}

export function CoursePage() {
  const { subject, number } = useParams()
  const location = useLocation()
  const [params] = useSearchParams()
  const term = params.get('term') || undefined
  const year = positiveYear(params.get('year'))
  const returnTo = safeReturnPath((location.state as { returnTo?: string } | null)?.returnTo)
  const [attempt, retry] = useState(0)
  const { course, error, loading } = useCourse(subject, number, term, year, attempt)

  useEffect(() => {
    document.title = course
      ? `${course.subject} ${course.number}: ${course.title} · UIUC Course Search`
      : `${subject ?? 'Course'} ${number ?? ''} · UIUC Course Search`.trim()
  }, [course, number, subject])

  if (loading) return <PageContainer className="py-8">
    <div role="status" aria-label="Loading course" className="flex flex-col gap-5">
      <Skeleton className="h-10 w-3/4" /><Skeleton className="h-72 w-full" />
    </div>
  </PageContainer>

  if (!course) return <PageContainer className="py-8">
    <BackLink to={returnTo} />
    <Alert variant="destructive" className="mt-4">
      <AlertCircleIcon aria-hidden />
      <AlertTitle>That course did not load</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <p>{error ?? 'Return to search and try the course again.'}</p>
        {subject && number && <Button variant="outline" onClick={() => retry((value) => value + 1)}>Try loading this course again</Button>}
      </AlertDescription>
    </Alert>
  </PageContainer>

  return <CourseView course={course} returnTo={returnTo} />
}

function CourseView({ course, returnTo }: { course: CourseDetailDto; returnTo: string }) {
  const details = [
    ['Registration notes', course.registration.registrationNotes],
    ['Approval code', course.registration.approvalCode],
    ['Schedule information', course.scheduleNotes.classScheduleInfo],
    ['Date range', course.scheduleNotes.dateRangeText],
    ['Course information', course.catalog.courseInfo],
    ['Degree attributes', course.catalog.degreeAttributes],
  ].filter((item): item is [string, string] => Boolean(item[1]))

  return <PageContainer className="py-6 sm:py-8">
    <BackLink to={returnTo} />
    <header className="mt-5 flex flex-col gap-4 border-b pb-6">
      <p className="text-muted-foreground text-sm font-medium">{formatTermLabel(course.term, course.year)}</p>
      <h1 className="max-w-5xl text-3xl leading-tight font-semibold">{course.subject} {course.number}: {course.title}</h1>
      <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-sm">
        <span>{formatCredits(course.creditHours, course.creditHoursText)}</span>
        {course.primaryInstructor && <span>{course.primaryInstructor}</span>}
        {course.requirements.map(courseRequirementLabel).map((label) => <Badge key={label} variant="outline">{label}</Badge>)}
      </div>
      {course.links.courseExplorerUrl && <a href={course.links.courseExplorerUrl} target="_blank" rel="noreferrer" className={buttonVariants({ className: 'w-fit' })}>
        <ExternalLinkIcon aria-hidden /> View official course listing
      </a>}
    </header>

    <div className="mt-6 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="flex min-w-0 flex-col gap-6">
        {details.length > 0 && <Panel id="registration-heading" title="Registration and catalog notes">
          <dl className="grid gap-4 md:grid-cols-2">{details.map(([label, value]) => <div key={label}>
            <dt className="text-muted-foreground text-xs font-medium uppercase">{label}</dt>
            <dd className="mt-1 text-sm leading-6">{value}</dd>
          </div>)}</dl>
        </Panel>}
        <section aria-labelledby="sections-heading">
          <div className="mb-3 flex flex-wrap justify-between gap-2">
            <h2 id="sections-heading" className="text-xl font-semibold">Sections and instructors</h2>
            <p className="text-muted-foreground text-xs">Verify status in the official listing before registering.</p>
          </div>
          <Card><CardContent className="p-0"><SectionsTable sections={course.sections ?? []} /></CardContent></Card>
        </section>
        <Panel id="description-heading" title="Description">
          <p className="leading-7">{course.description || 'No catalog description is available for this offering.'}</p>
        </Panel>
      </div>
      <aside className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-24">
        <Scorecard
          qualityScore={course.metrics.qualityScore}
          instructorDifficultyScore={course.metrics.instructorDifficultyScore}
          avgGpa={course.metrics.avgGpa}
          gpaSampleSize={course.metrics.gpaSampleSize}
          primaryInstructorRmp={course.metrics.primaryInstructorRating}
        />
        <FeedbackButton
          buttonLabel="Report a signal issue"
          page="course"
          fullWidth
          buttonVariant="outline"
          context={{
            courseId: course.id, subject: course.subject, number: course.number,
            term: course.term, year: course.year, metadata: course.metrics,
          }}
        />
      </aside>
    </div>
  </PageContainer>
}

function Panel({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section aria-labelledby={id}><Card>
    <CardHeader><h2 id={id} className="text-xl font-semibold">{title}</h2></CardHeader>
    <CardContent>{children}</CardContent>
  </Card></section>
}

function BackLink({ to }: { to: string }) {
  return <Link to={to} className={buttonVariants({ variant: 'ghost', className: '-ml-2' })}>
    <ArrowLeftIcon aria-hidden /> Back to search results
  </Link>
}

function safeReturnPath(value?: string) {
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/'
}

function positiveYear(value: string | null) {
  const year = Number(value)
  return Number.isInteger(year) && year > 0 ? year : undefined
}
