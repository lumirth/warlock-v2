import { AlertCircleIcon, InfoIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import type {
  CourseSummaryDto,
  MatchEvidence,
  SearchChipDto,
  SearchCourseResultDto,
  SearchMetaDto,
  SearchResponseDto,
  SearchSort,
  SortField,
} from '@uiuc-course-search/query-types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
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
import { metricToneTextClass } from '../../utils/grading'
import type { ResultViewMode } from './search-sort-model'

export function ResultsList({
  meta,
  results,
  pagination,
  loading,
  loadingMore,
  sort,
  resultViewMode,
  showInitialSkeleton,
  isRefreshingResults,
  resultsHeadingLabel,
  showingResultsLabel,
  onSortFieldChange,
  onDirectionToggle,
  onViewChange,
  onTableSort,
  onRemoveChip,
  onLoadMore,
  feedbackAction,
  returnTo,
}: {
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
}) {
  const searchIsDegraded =
    meta?.retrieval?.degraded === true || pagination?.countIsComplete === false

  return (
    <div aria-busy={loading || loadingMore} className="flex flex-col gap-3">
      <p className="sr-only" role="status" aria-live="polite">
        {loadingMore
          ? 'Loading more course results'
          : loading
            ? 'Updating course results'
            : `${results.length.toLocaleString()} course results shown`}
      </p>
      {searchIsDegraded && !showInitialSkeleton ? (
        <Alert className="border-warning/50 bg-warning/5 py-1.5">
          <AlertCircleIcon className="text-warning" aria-hidden />
          <AlertTitle>Partial search results</AlertTitle>
          <AlertDescription>
            Some search sources did not respond, so these results may be
            incomplete. Try again later for the full set.
          </AlertDescription>
        </Alert>
      ) : null}
      {meta?.retrieval?.sortLimitedToRetrievedWindow &&
      !showInitialSkeleton ? (
        <Alert className="border-border bg-muted/40 py-1.5">
          <InfoIcon className="text-muted-foreground" aria-hidden />
          <AlertTitle>Sorted within retrieved topic matches</AlertTitle>
          <AlertDescription>
            Semantic search retrieves a bounded set of relevant courses. This
            sort orders that retrieved set, not every course in the catalog.
            Refine the search to narrow the comparison.
          </AlertDescription>
        </Alert>
      ) : null}
      {!meta && !loading ? null : showInitialSkeleton ? (
        <ResultsSkeleton />
      ) : results.length === 0 && meta ? (
        <EmptyResults meta={meta} onRemoveChip={onRemoveChip} />
      ) : (
        <div className="flex flex-col gap-3">
          {meta && (
            <div className="flex flex-wrap items-end justify-between gap-3 py-1">
              <div>
                <h2 className="font-semibold">{resultsHeadingLabel}</h2>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <ResultsToolbar
                  showingResultsLabel={showingResultsLabel}
                  sort={sort}
                  resultViewMode={resultViewMode}
                  isRefreshing={isRefreshingResults}
                  onSortFieldChange={onSortFieldChange}
                  onDirectionToggle={onDirectionToggle}
                  onViewChange={onViewChange}
                />
                {feedbackAction}
              </div>
            </div>
          )}
          <p className="sr-only" aria-live="polite">
            {resultViewMode === 'table'
              ? 'Table view selected'
              : 'Cards view selected'}
          </p>
          {resultViewMode === 'table' ? (
            <CourseResultsTable
              results={results}
              sort={sort}
              onSort={onTableSort}
              returnTo={returnTo}
            />
          ) : (
            results.map((result) => (
              <CourseResultCard
                key={getCourseKey(result.course)}
                result={result}
                returnTo={returnTo}
              />
            ))
          )}
          {pagination?.hasMore && (
            <div className="flex justify-center pt-2">
              <Button
                variant="secondary"
                onClick={onLoadMore}
                disabled={loadingMore}
              >
                {loadingMore && (
                  <Spinner data-icon="inline-start" aria-hidden />
                )}
                {loadingMore ? 'Loading more results' : 'Show more results'}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ResultsSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Searching courses"
      className="flex flex-col gap-3"
    >
      {[0, 1, 2].map((index) => (
        <Card key={index}>
          <CardContent className="flex flex-col gap-3">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-12 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function CourseResultCard({
  result,
  returnTo,
}: {
  result: SearchCourseResultDto
  returnTo: string
}) {
  const { course } = result
  const isHistorical = isHistoricalResult(result)
  const registration = registrationSummaryDisplay(course)

  return (
    <Link
      to={getCoursePath(course)}
      state={{ fromSearch: true, returnTo }}
      className="text-foreground block no-underline"
    >
      <Card
        className={cn(
          'hover:bg-muted/60 transition-colors',
          isHistorical && 'border-border bg-muted/60'
        )}
        data-historical={isHistorical ? 'true' : undefined}
      >
        <CardContent>
          <div className="min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3
                className={cn(
                  'min-w-0 flex-1 text-base leading-snug font-bold break-words',
                  isHistorical && 'text-muted-foreground'
                )}
              >
                {course.subject} {course.number}: {course.title}
              </h3>
            </div>
            <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span className={cn(isHistorical && 'font-semibold')}>
                {formatTermLabel(course.term, course.year)}
              </span>
              {isHistorical && (
                <Badge variant="outline" className="text-muted-foreground">
                  Historical term
                </Badge>
              )}
              {course.creditHoursText ||
              typeof course.creditHours === 'number' ? (
                <span>
                  {formatCredits(
                    course.creditHours,
                    course.creditHoursText
                  )}
                </span>
              ) : null}
              {course.primaryInstructor && (
                <span className="border-l pl-2">
                  {course.primaryInstructor}
                </span>
              )}
              {courseRequirementLabels(course).map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
            {registration ? (
              <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t pt-3 text-sm">
                <span
                  className={cn(
                    'font-semibold',
                    registration.tone === 'success' && 'text-success',
                    registration.tone === 'warning' && 'text-warning',
                    registration.tone === 'destructive' && 'text-destructive',
                    registration.tone === 'muted' && 'text-muted-foreground'
                  )}
                >
                  {registration.primary}
                </span>
                <span className="text-muted-foreground text-xs">
                  {registration.detail}
                </span>
                {registration.updated ? (
                  <span className="text-muted-foreground text-xs">
                    · {registration.updated}
                  </span>
                ) : null}
              </div>
            ) : null}
            <ScoreSummary course={course} />
            {course.description ? (
              <p
                className={cn(
                  'text-muted-foreground mt-2 line-clamp-3 max-w-3xl text-sm leading-6',
                  isHistorical && 'opacity-80'
                )}
              >
                {course.description}
              </p>
            ) : null}
            <MatchEvidence evidence={result.matchEvidence} />
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

function ScoreSummary({ course }: { course: CourseSummaryDto }) {
  const stats = getCourseMetrics(course)
  if (stats.length === 0) return null

  return (
    <dl className="mt-3 grid max-w-2xl grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-x-4 gap-y-2 border-t pt-3">
      {stats.map((stat) => (
        <div key={stat.label} title={stat.title} className="min-w-0">
          <dt className="text-muted-foreground text-xs">{stat.label}</dt>
          <dd
            className={cn(
              'text-sm font-semibold tabular-nums',
              metricToneTextClass(stat.tone)
            )}
          >
            {stat.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function MatchEvidence({
  evidence,
}: {
  evidence: MatchEvidence[] | undefined
}) {
  const labels =
    evidence
      ?.slice(0, 3)
      .map((item) => item.label)
      .filter(Boolean) ?? []

  if (labels.length === 0) {
    return null
  }

  return (
    <div
      className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1"
      aria-label="Match evidence"
    >
      <span className="text-muted-foreground text-xs">Matched</span>
      {labels.map((label, index) => (
        <span
          key={`${label}-${index}`}
          className="text-muted-foreground text-xs"
        >
          {label}
        </span>
      ))}
    </div>
  )
}
