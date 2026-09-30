import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  SEARCH_SORT_DEFAULT_DIRECTIONS,
  type CourseSummaryDto,
  type SearchCourseResultDto,
  type SearchSort,
  type SortField,
} from '@warlock-v2/query-types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import {
  getInstructorDifficultyLabel, getInstructorDifficultyTone, getQualityLabel,
  getQualityTone, isFiniteMetric, metricToneTextClass,
} from '../../utils/grading'
import { TABLE_SORT_COLUMNS, type TableSortColumn } from './search-options'
import {
  formatCourseLevel, formatCredits, formatNumber, formatTermLabel, getCourseKey,
  getCoursePath, isHistoricalResult, registrationSummaryDisplay,
} from './search-result-model'
import { sortButtonLabel } from './search-sort-model'

type Sort = (field: Exclude<SortField, 'relevance'>) => void

export function CourseResultsTable({ results, sort, onSort, returnTo }: {
  results: SearchCourseResultDto[]
  sort: SearchSort
  onSort: Sort
  returnTo: string
}) {
  return <Table scrollAreaLabel="Course search results" className="min-w-[1040px]">
    <TableHeader><TableRow>
      <TableHead scope="col">Course</TableHead><TableHead scope="col">Registration</TableHead><TableHead scope="col">Term</TableHead>
      {TABLE_SORT_COLUMNS.map((column) => <SortableHead key={column.field} column={column} sort={sort} onSort={onSort} />)}
    </TableRow></TableHeader>
    <TableBody>{results.map((result) => <ResultRow key={getCourseKey(result.course)} result={result} returnTo={returnTo} />)}</TableBody>
  </Table>
}

function ResultRow({ result, returnTo }: { result: SearchCourseResultDto; returnTo: string }) {
  const course = result.course
  const historical = isHistoricalResult(result)
  return <TableRow className={cn(historical && 'bg-muted/50')}>
    <CourseCell course={course} returnTo={returnTo} />
    <RegistrationCell course={course} />
    <TermCell course={course} historical={historical} />
    <TableCell className="tabular-nums">{formatNumber(course.metrics.avgGpa, 2)}</TableCell>
    <MetricCell value={qualityLabel(course)} tone="quality" />
    <MetricCell value={difficultyLabel(course)} tone="difficulty" />
    <TableCell className="tabular-nums">{formatNumber(course.metrics.primaryInstructorRating, 1)}</TableCell>
    <TableCell className="tabular-nums">{formatCourseLevel(course)}</TableCell>
    <TableCell className="tabular-nums">{formatCredits(course.creditHours, course.creditHoursText)}</TableCell>
  </TableRow>
}

function qualityLabel(course: CourseSummaryDto) {
  return isFiniteMetric(course.metrics.qualityScore) ? getQualityLabel(course.metrics.qualityScore) : null
}
function difficultyLabel(course: CourseSummaryDto) {
  return isFiniteMetric(course.metrics.instructorDifficultyScore)
    ? getInstructorDifficultyLabel(course.metrics.instructorDifficultyScore) : null
}

function CourseCell({ course, returnTo }: { course: CourseSummaryDto; returnTo: string }) {
  return <TableCell className="max-w-80 whitespace-normal">
    <Link to={getCoursePath(course)} state={{ fromSearch: true, returnTo }} className="font-medium hover:underline">
      {course.subject} {course.number}
    </Link>
    <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">{course.title}</p>
    {course.primaryInstructor && <p className="text-muted-foreground mt-1 text-xs">{course.primaryInstructor}</p>}
  </TableCell>
}

const registrationTone = {
  success: 'text-success', warning: 'text-warning', destructive: 'text-destructive', muted: 'text-muted-foreground',
}
function RegistrationCell({ course }: { course: CourseSummaryDto }) {
  const registration = registrationSummaryDisplay(course)
  if (!registration) return <TableCell><Missing /></TableCell>
  return <TableCell><strong className={registrationTone[registration.tone]}>{registration.primary}</strong>
    <small className="text-muted-foreground block">{registration.updated ?? registration.detail}</small>
  </TableCell>
}

function TermCell({ course, historical }: { course: CourseSummaryDto; historical: boolean }) {
  return <TableCell>{formatTermLabel(course.term, course.year)}
    {historical && <Badge variant="outline" className="text-muted-foreground mt-1 block">Historical</Badge>}
  </TableCell>
}

function MetricCell({ value, tone }: { value: string | null; tone: 'quality' | 'difficulty' }) {
  if (!value) return <TableCell><Missing /></TableCell>
  const metricTone = tone === 'quality' ? getQualityTone(value as ReturnType<typeof getQualityLabel>)
    : getInstructorDifficultyTone(value as ReturnType<typeof getInstructorDifficultyLabel>)
  return <TableCell><strong className={metricToneTextClass(metricTone)}>{value}</strong></TableCell>
}

function Missing() {
  return <span className="text-muted-foreground"><span aria-hidden>—</span><span className="sr-only">Not available</span></span>
}

function SortableHead({ column, sort, onSort }: { column: TableSortColumn; sort: SearchSort; onSort: Sort }) {
  const active = sort.field === column.field
  const direction = active ? sort.direction : SEARCH_SORT_DEFAULT_DIRECTIONS[column.field]
  const ariaSort = active ? direction === 'asc' ? 'ascending' : 'descending' : undefined
  return <TableHead scope="col" aria-sort={ariaSort} className={column.className}>
    <Button size="xs" variant="ghost" className="-ml-2" aria-label={sortButtonLabel(column.label, active, direction)} onClick={() => onSort(column.field)}>
      {column.label}{active && (direction === 'asc' ? <ArrowUpIcon aria-hidden /> : <ArrowDownIcon aria-hidden />)}
    </Button>
  </TableHead>
}
