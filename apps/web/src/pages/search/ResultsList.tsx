import { Link } from 'react-router-dom'
import type {
  MatchEvidence,
  SearchChipDto,
  SearchCourseResultDto,
  SearchMetaDto,
  SearchRecoveryGroup,
  SearchSort,
  SortField,
} from '@uiuc-course-search/query-types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { EmptyResults } from './EmptyResults'
import { CourseResultsTable } from './ResultsTable'
import { ResultsToolbar } from './ResultsToolbar'
import {
  courseGenedLabels,
  formatTermLabel,
  getCourseKey,
  getCourseMetrics,
  getCoursePath,
  toneTextClass,
} from './search-result-model'
import type { ResultViewMode } from './search-sort-model'
import type { SearchPagination } from './search-types'

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
  recoveryGroups,
  onSortFieldChange,
  onDirectionToggle,
  onViewChange,
  onTableSort,
  onRemoveChip,
  onApplyRecoveryGroup,
  onLoadMore,
}: {
  meta: SearchMetaDto | null
  results: SearchCourseResultDto[]
  pagination: SearchPagination | null
  loading: boolean
  loadingMore: boolean
  sort: SearchSort
  resultViewMode: ResultViewMode
  showInitialSkeleton: boolean
  isRefreshingResults: boolean
  resultsHeadingLabel: string
  showingResultsLabel: string
  recoveryGroups: SearchRecoveryGroup[]
  onSortFieldChange: (field: SortField) => void
  onDirectionToggle: () => void
  onViewChange: (view: ResultViewMode) => void
  onTableSort: (field: Exclude<SortField, 'relevance'>) => void
  onRemoveChip: (chip: SearchChipDto) => void
  onApplyRecoveryGroup: (group: SearchRecoveryGroup) => void
  onLoadMore: () => void
}) {
  return (
    <div aria-busy={loading} className="flex flex-col gap-3">
      {!meta && !loading ? null : showInitialSkeleton ? (
        <ResultsSkeleton />
      ) : results.length === 0 && meta ? (
        <EmptyResults
          meta={meta}
          recoveryGroups={recoveryGroups}
          onRemoveChip={onRemoveChip}
          onApplyRecoveryGroup={onApplyRecoveryGroup}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {meta && (
            <div className="flex flex-wrap items-end justify-between gap-3 py-1">
              <div>
                <h2 className="font-semibold">{resultsHeadingLabel}</h2>
              </div>
              <ResultsToolbar
                showingResultsLabel={showingResultsLabel}
                sort={sort}
                resultViewMode={resultViewMode}
                isRefreshing={isRefreshingResults}
                onSortFieldChange={onSortFieldChange}
                onDirectionToggle={onDirectionToggle}
                onViewChange={onViewChange}
              />
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
            />
          ) : (
            results.map((course) => (
              <CourseResultCard key={getCourseKey(course)} course={course} />
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
                Show more results
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
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="h-7 w-32" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-5 w-28" />
          </div>
        </CardContent>
      </Card>
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

function CourseResultCard({ course }: { course: SearchCourseResultDto }) {
  const isHistorical = course.search?.historical === true

  return (
    <Link
      to={getCoursePath(course)}
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
              <span>{course.credit_hours} credits</span>
              {course.primary_instructor && (
                <span className="border-l pl-2">
                  {course.primary_instructor}
                </span>
              )}
              {courseGenedLabels(course).map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
            <ScoreSummary course={course} />
            <p
              className={cn(
                'text-muted-foreground mt-2 line-clamp-3 max-w-3xl text-sm leading-6',
                isHistorical && 'opacity-80'
              )}
            >
              {course.description}
            </p>
            <MatchEvidence evidence={course.match_evidence} />
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

function ScoreSummary({ course }: { course: SearchCourseResultDto }) {
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
              toneTextClass(stat.tone)
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
      ?.slice(0, 5)
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
