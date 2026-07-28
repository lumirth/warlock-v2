import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  SEARCH_SORT_DEFAULT_DIRECTIONS,
  type SearchCourseResultDto,
  type SearchSort,
  type SortField,
} from '@uiuc-course-search/query-types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  getQualityLabel,
  getQualityTone,
  getInstructorDifficultyLabel,
  getInstructorDifficultyTone,
  isFiniteMetric,
  metricToneTextClass,
} from '../../utils/grading'
import { cn } from '@/lib/utils'
import { TABLE_SORT_COLUMNS, type TableSortColumn } from './search-options'
import {
  formatCourseLevel,
  formatCredits,
  formatNumber,
  formatTermLabel,
  getCourseKey,
  getCoursePath,
  isHistoricalResult,
  registrationSummaryDisplay,
} from './search-result-model'
import { sortButtonLabel } from './search-sort-model'

export function CourseResultsTable({
  results,
  sort,
  onSort,
  returnTo,
}: {
  results: SearchCourseResultDto[]
  sort: SearchSort
  onSort: (field: Exclude<SortField, 'relevance'>) => void
  returnTo: string
}) {
  return (
    <Table scrollAreaLabel="Course search results" className="min-w-[1040px]">
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Course</TableHead>
          <TableHead scope="col">Registration</TableHead>
          <TableHead scope="col">Term</TableHead>
          {TABLE_SORT_COLUMNS.map((column) => (
            <SortableTableHead
              key={column.field}
              column={column}
              sort={sort}
              onSort={onSort}
            />
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {results.map((result) => {
          const { course } = result
          const isHistorical = isHistoricalResult(result)
          const registration = registrationSummaryDisplay(course)
          const qualityLabel = isFiniteMetric(course.metrics.qualityScore)
            ? getQualityLabel(course.metrics.qualityScore)
            : null
          const instructorDifficultyLabel = isFiniteMetric(
            course.metrics.instructorDifficultyScore
          )
            ? getInstructorDifficultyLabel(
                course.metrics.instructorDifficultyScore
              )
            : null

          return (
            <TableRow
              key={getCourseKey(course)}
              data-historical={isHistorical ? 'true' : undefined}
              className={cn(isHistorical && 'bg-muted/50')}
            >
              <TableCell className="max-w-80 whitespace-normal">
                <Link
                  to={getCoursePath(course)}
                  state={{ fromSearch: true, returnTo }}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {course.subject} {course.number}
                </Link>
                <div className="text-muted-foreground mt-1 line-clamp-2 text-xs leading-5">
                  {course.title}
                </div>
                {course.primaryInstructor ? (
                  <div className="text-muted-foreground mt-1 text-xs">
                    {course.primaryInstructor}
                  </div>
                ) : null}
              </TableCell>
              <TableCell>
                {registration ? (
                  <div className="flex flex-col">
                    <span
                      className={cn(
                        'font-semibold',
                        registration.tone === 'success' && 'text-success',
                        registration.tone === 'warning' && 'text-warning',
                        registration.tone === 'destructive' &&
                          'text-destructive',
                        registration.tone === 'muted' && 'text-muted-foreground'
                      )}
                    >
                      {registration.primary}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {registration.updated ?? registration.detail}
                    </span>
                  </div>
                ) : (
                  <MissingValue />
                )}
              </TableCell>
              <TableCell>
                <div className="flex flex-col gap-1">
                  <span>{formatTermLabel(course.term, course.year)}</span>
                  {isHistorical && (
                    <Badge
                      variant="outline"
                      className="text-muted-foreground w-fit"
                    >
                      Historical
                    </Badge>
                  )}
                </div>
              </TableCell>
              <TableCell>
                {qualityLabel ? (
                  <span
                    className={cn(
                      'font-semibold',
                      metricToneTextClass(getQualityTone(qualityLabel))
                    )}
                  >
                    {qualityLabel}
                  </span>
                ) : (
                  <MissingValue />
                )}
              </TableCell>
              <TableCell>
                {instructorDifficultyLabel ? (
                  <span
                    className={cn(
                      'font-semibold',
                      metricToneTextClass(
                        getInstructorDifficultyTone(
                          instructorDifficultyLabel
                        )
                      )
                    )}
                  >
                    {instructorDifficultyLabel}
                  </span>
                ) : (
                  <MissingValue />
                )}
              </TableCell>
              <TableCell className="tabular-nums">
                {formatNumber(course.metrics.avgGpa, 2)}
              </TableCell>
              <TableCell className="tabular-nums">
                {formatNumber(course.metrics.primaryInstructorRating, 1)}
              </TableCell>
              <TableCell className="tabular-nums">
                {formatCourseLevel(course)}
              </TableCell>
              <TableCell className="tabular-nums">
                {formatCredits(course.creditHours, course.creditHoursText)}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

function MissingValue() {
  return (
    <span className="text-muted-foreground">
      <span aria-hidden>—</span>
      <span className="sr-only">Not available</span>
    </span>
  )
}

function SortableTableHead({
  column,
  sort,
  onSort,
}: {
  column: TableSortColumn
  sort: SearchSort
  onSort: (field: Exclude<SortField, 'relevance'>) => void
}) {
  const isActive = sort.field === column.field
  const direction = isActive
    ? sort.direction
    : SEARCH_SORT_DEFAULT_DIRECTIONS[column.field]

  return (
    <TableHead
      scope="col"
      aria-sort={
        isActive
          ? direction === 'asc'
            ? 'ascending'
            : 'descending'
          : undefined
      }
      className={column.className}
    >
      <Button
        type="button"
        size="xs"
        variant="ghost"
        className="-ml-2 justify-start px-2"
        aria-label={sortButtonLabel(column.label, isActive, direction)}
        onClick={() => onSort(column.field)}
      >
        {column.label}
        {isActive &&
          (direction === 'asc' ? (
            <ArrowUpIcon data-icon="inline-end" aria-hidden />
          ) : (
            <ArrowDownIcon data-icon="inline-end" aria-hidden />
          ))}
      </Button>
    </TableHead>
  )
}
