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
import { getQualityLabel, getQualityTone } from '../../utils/grading'
import { cn } from '@/lib/utils'
import { TABLE_SORT_COLUMNS, type TableSortColumn } from './search-options'
import {
  formatCourseLevel,
  formatCredits,
  formatNumber,
  formatTermLabel,
  getCourseKey,
  getCoursePath,
  getWorkloadLabel,
  getWorkloadTone,
  toneTextClass,
} from './search-result-model'
import { sortButtonLabel } from './search-sort-model'

export function CourseResultsTable({
  results,
  sort,
  onSort,
}: {
  results: SearchCourseResultDto[]
  sort: SearchSort
  onSort: (field: Exclude<SortField, 'relevance'>) => void
}) {
  return (
    <Table className="min-w-[880px]">
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Course</TableHead>
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
        {results.map((course) => {
          const isHistorical = course.search?.historical === true
          const qualityLabel =
            typeof course.quality_score === 'number'
              ? getQualityLabel(course.quality_score)
              : null
          const workloadLabel =
            typeof course.difficulty_score === 'number'
              ? getWorkloadLabel(course.difficulty_score)
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
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {course.subject} {course.number}
                </Link>
                <div className="text-muted-foreground mt-1 line-clamp-2 text-xs leading-5">
                  {course.title}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex flex-col gap-1">
                  <span>{formatTermLabel(course.term, course.year)}</span>
                  {isHistorical && (
                    <Badge
                      variant="outline"
                      className="w-fit text-muted-foreground"
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
                      toneTextClass(getQualityTone(qualityLabel))
                    )}
                  >
                    {qualityLabel}
                  </span>
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </TableCell>
              <TableCell>
                {workloadLabel ? (
                  <span
                    className={cn(
                      'font-semibold',
                      toneTextClass(getWorkloadTone(course.difficulty_score!))
                    )}
                  >
                    {workloadLabel}
                  </span>
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </TableCell>
              <TableCell className="tabular-nums">
                {formatNumber(course.avg_gpa, 2)}
              </TableCell>
              <TableCell className="tabular-nums">
                {formatNumber(course.primary_instructor_rmp, 1)}
              </TableCell>
              <TableCell className="tabular-nums">
                {formatCourseLevel(course)}
              </TableCell>
              <TableCell className="tabular-nums">
                {formatCredits(course.credit_hours)}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
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
        isActive ? (direction === 'asc' ? 'ascending' : 'descending') : undefined
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
