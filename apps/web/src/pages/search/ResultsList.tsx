import { AlertCircleIcon, InfoIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import type {
  CourseSummaryDto,
  SearchChipDto,
  SearchCourseResultDto,
  SearchMetaDto,
  SearchResponseDto,
  SearchSort,
  SortField,
} from '@uiuc-course-search/query-types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { metricToneTextClass } from '../../utils/grading'
import { EmptyResults } from './EmptyResults'
import { CourseResultsTable } from './ResultsTable'
import { ResultsToolbar } from './ResultsToolbar'
import {
  courseRequirementLabels,
  formatCredits,
  formatTermLabel,
  getCourseKey,
  getCourseMetrics,
  getCoursePath,
  isHistoricalResult,
  registrationSummaryDisplay,
} from './search-result-model'
import type { ResultViewMode } from './search-sort-model'

type Props = {
  meta: SearchMetaDto | null
  results: SearchCourseResultDto[]
  pagination: SearchResponseDto['pagination'] | null
  loading: boolean
  loadingMore: boolean
  sort: SearchSort
  resultViewMode: ResultViewMode
  showInitialSkeleton: boolean
  isRefreshingResults: boolean
  resultsHeadingLabel: string
  showingResultsLabel: string
  feedbackAction?: ReactNode
  returnTo: string
  onSortFieldChange: (field: SortField) => void
  onDirectionToggle: () => void
  onViewChange: (view: ResultViewMode) => void
  onTableSort: (field: Exclude<SortField, 'relevance'>) => void
  onRemoveChip: (chip: SearchChipDto) => void
  onLoadMore: () => void
}

export function ResultsList(props: Props) {
  return <div aria-busy={props.loading || props.loadingMore} className="flex flex-col gap-3">
    <p className="sr-only" role="status" aria-live="polite">{loadingLabel(props)}</p>
    <Notices {...props} />
    <ResultContent {...props} />
  </div>
}

function loadingLabel({ loadingMore, loading, results }: Props) {
  if (loadingMore) return 'Loading more course results'
  if (loading) return 'Updating course results'
  return `${results.length} course results shown`
}

function Notices({ meta, showInitialSkeleton }: Props) {
  if (showInitialSkeleton) return null
  const degraded = meta?.retrieval?.degraded
  return <>
    {degraded && <Notice icon="warning" title="Partial search results">
      Some search sources did not respond, so these results may be incomplete. Try again later for the full set.
    </Notice>}
  </>
}

function Notice({ icon = 'info', title, children }: { icon?: 'info' | 'warning'; title: string; children: ReactNode }) {
  const Icon = icon === 'warning' ? AlertCircleIcon : InfoIcon
  return <Alert className={icon === 'warning' ? 'border-warning/50 bg-warning/5' : 'bg-muted/40'}>
    <Icon aria-hidden /><AlertTitle>{title}</AlertTitle><AlertDescription>{children}</AlertDescription>
  </Alert>
}

function ResultContent(props: Props) {
  if (!props.meta && !props.loading) return null
  if (props.showInitialSkeleton) return <div role="status" aria-label="Searching courses" className="grid gap-3">
    {[0, 1, 2].map((key) => <div key={key} className="bg-muted h-28 animate-pulse rounded-xl" />)}
  </div>
  if (!props.results.length && props.meta) return <EmptyResults meta={props.meta} onRemoveChip={props.onRemoveChip} />

  return <div className="flex flex-col gap-3">
    <ResultsHeader {...props} />
    <ResultItems {...props} />
    <LoadMore {...props} />
  </div>
}

function ResultsHeader(props: Props) {
  if (!props.meta) return null
  return <div className="flex flex-wrap items-end justify-between gap-3 py-1">
      <h2 className="font-semibold">{props.resultsHeadingLabel}</h2>
      <div className="flex flex-wrap items-center gap-2">
        <ResultsToolbar
          showingResultsLabel={props.showingResultsLabel}
          sort={props.sort}
          resultViewMode={props.resultViewMode}
          isRefreshing={props.isRefreshingResults}
          onSortFieldChange={props.onSortFieldChange}
          onDirectionToggle={props.onDirectionToggle}
          onViewChange={props.onViewChange}
        />
        {props.feedbackAction}
      </div>
  </div>
}

function ResultItems(props: Props) {
  const table = props.resultViewMode === 'table'
  return <>
    <p className="sr-only" aria-live="polite">{table ? 'Table view selected' : 'Cards view selected'}</p>
    {table ? <CourseResultsTable results={props.results} sort={props.sort} onSort={props.onTableSort} returnTo={props.returnTo} />
      : props.results.map((result) => <CourseCard key={getCourseKey(result.course)} result={result} returnTo={props.returnTo} />)}
  </>
}

function LoadMore(props: Props) {
  if (!props.pagination?.hasMore) return null
  return <Button variant="secondary" className="self-center" onClick={props.onLoadMore} disabled={props.loadingMore}>
    {props.loadingMore && <Spinner aria-hidden />} {props.loadingMore ? 'Loading more results' : 'Show more results'}
  </Button>
}

const registrationTone = {
  success: 'text-success',
  warning: 'text-warning',
  destructive: 'text-destructive',
  muted: 'text-muted-foreground',
}

function CourseCard({ result, returnTo }: { result: SearchCourseResultDto; returnTo: string }) {
  const course = result.course
  const historical = isHistoricalResult(result)
  const registration = registrationSummaryDisplay(course)
  const facts = [
    formatTermLabel(course.term, course.year),
    course.creditHoursText || typeof course.creditHours === 'number' ? formatCredits(course.creditHours, course.creditHoursText) : null,
    course.primaryInstructor,
    ...courseRequirementLabels(course),
  ].filter(Boolean)
  return <Link to={getCoursePath(course)} state={{ fromSearch: true, returnTo }} className="text-foreground no-underline">
    <Card className={cn('hover:bg-muted/60 transition-colors', historical && 'bg-muted/60')}>
      <CardContent>
        <h3 className={cn('text-base font-bold', historical && 'text-muted-foreground')}>
          {course.subject} {course.number}: {course.title}
        </h3>
        <div className="text-muted-foreground mt-1 flex flex-wrap gap-2 text-xs">
          {facts.map((fact, index) => <span key={`${fact}-${index}`}>{fact}</span>)}
          {historical && <Badge variant="outline">Historical term</Badge>}
        </div>
        {registration && <div className="mt-3 flex flex-wrap gap-2 border-t pt-3 text-sm">
          <strong className={registrationTone[registration.tone]}>{registration.primary}</strong>
          <span className="text-muted-foreground text-xs">{registration.detail} · {registration.updated}</span>
        </div>}
        <ScoreSummary course={course} />
        {course.description && <p className="text-muted-foreground mt-2 line-clamp-3 text-sm leading-6">{course.description}</p>}
        <Evidence labels={result.matchEvidence?.slice(0, 3) ?? []} />
      </CardContent>
    </Card>
  </Link>
}

function ScoreSummary({ course }: { course: CourseSummaryDto }) {
  const stats = getCourseMetrics(course)
  if (!stats.length) return null
  return <dl className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-2 border-t pt-3">
    {stats.map((stat) => <div key={stat.label} title={stat.title}>
      <dt className="text-muted-foreground text-xs">{stat.label}</dt>
      <dd className={cn('text-sm font-semibold', metricToneTextClass(stat.tone))}>{stat.value}</dd>
    </div>)}
  </dl>
}

function Evidence({ labels }: { labels: string[] }) {
  if (!labels.length) return null
  return <p className="text-muted-foreground mt-2 text-xs" aria-label="Match evidence">Matched · {labels.join(' · ')}</p>
}
