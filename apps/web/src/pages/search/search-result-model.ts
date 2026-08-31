import {
  courseRequirementShortLabel,
  type SearchCourseResultDto,
  type CourseSummaryDto,
  type SearchChipDto,
} from '@uiuc-course-search/query-types'
import {
  getQualityLabel,
  getQualityTone,
  getInstructorDifficultyLabel,
  getInstructorDifficultyTone,
  isFiniteMetric,
  type MetricTone,
} from '../../utils/grading'
import { cn } from '@/lib/utils'

type Tone = MetricTone

type CourseResultMetric = {
  label: string
  value: string
  tone?: Tone
  title?: string
}

export type RegistrationSummaryDisplay = {
  primary: string
  detail: string
  tone: 'success' | 'warning' | 'destructive' | 'muted'
  updated: string | null
}

export function getCourseKey(course: CourseSummaryDto): string {
  return (
    course.id ||
    `${course.subject}-${course.number}-${course.term}-${course.year}`
  )
}

export function getCoursePath(course: CourseSummaryDto): string {
  const params = new URLSearchParams({
    term: course.term,
    year: String(course.year),
  })
  return `/course/${encodeURIComponent(course.subject)}/${encodeURIComponent(course.number)}?${params.toString()}`
}

export function isHistoricalResult(result: SearchCourseResultDto): boolean {
  return (
    result.warnings?.some((warning) => warning.kind === 'historical') ?? false
  )
}

export function getCourseMetrics(
  course: CourseSummaryDto
): CourseResultMetric[] {
  const qualityScore = course.metrics.qualityScore
  const instructorDifficultyScore = course.metrics.instructorDifficultyScore
  const primaryInstructorRmp = course.metrics.primaryInstructorRating
  const avgGpa = course.metrics.avgGpa
  const stats: CourseResultMetric[] = []

  if (isFiniteMetric(qualityScore)) {
    const qualityLabel = getQualityLabel(qualityScore)
    stats.push({
      label: 'Quality signal',
      value: qualityLabel,
      tone: getQualityTone(qualityLabel),
      title:
        typeof course.metrics.gpaSampleSize === 'number'
          ? `Evidence-limited GPA and linked RMP composite; ${course.metrics.gpaSampleSize.toLocaleString()} GPA records`
          : 'Evidence-limited GPA and linked RMP composite',
    })
  }
  if (isFiniteMetric(instructorDifficultyScore)) {
    const difficultyLabel = getInstructorDifficultyLabel(
      instructorDifficultyScore
    )
    stats.push({
      label: 'Instructor difficulty',
      value: difficultyLabel,
      tone: getInstructorDifficultyTone(difficultyLabel),
      title:
        'Linked RMP instructor difficulty; not a measure of assigned work.',
    })
  }
  if (isFiniteMetric(primaryInstructorRmp)) {
    stats.push({
      label: 'RMP rating',
      value: `${primaryInstructorRmp.toFixed(1)} / 5`,
      title:
        'Rate My Professors rating; review the source and sample size before deciding.',
    })
  }
  if (isFiniteMetric(avgGpa)) {
    stats.push({
      label: 'Avg GPA',
      value: avgGpa.toFixed(2),
      title:
        typeof course.metrics.gpaSampleSize === 'number'
          ? `Based on ${course.metrics.gpaSampleSize.toLocaleString()} GPA records`
          : undefined,
    })
  }

  return stats
}

export function getChipClass(chip: SearchChipDto): string {
  return cn(
    'border-border bg-secondary text-secondary-foreground',
    chip.type === 'topic' && 'text-muted-foreground'
  )
}

export function formatTermLabel(term: string, year: number): string {
  return `${term.charAt(0).toUpperCase()}${term.slice(1).toLowerCase()} ${year}`
}

export function courseRequirementLabels(course: CourseSummaryDto): string[] {
  if (course.requirements.length > 0) {
    return course.requirements.map(courseRequirementShortLabel)
  }
  return []
}

export function formatCourseLevel(course: CourseSummaryDto): string {
  const number = parseInt(course.number, 10)
  if (Number.isNaN(number)) return '-'

  const level = Math.floor(number / 100) * 100
  return level >= 500 ? '500+' : String(level)
}

export function formatNumber(
  value: number | null | undefined,
  digits: number
): string {
  return isFiniteMetric(value) ? value.toFixed(digits) : '-'
}

export function formatCredits(
  exact: number | null,
  officialText?: string | null
): string {
  const text = officialText?.trim()
  if (text) {
    return /\b(?:credits?|hours?|hrs?)\b/i.test(text)
      ? text
      : `${text} ${text === '1' ? 'credit' : 'credits'}`
  }
  if (!isFiniteMetric(exact)) return 'Not available'
  return `${exact} ${exact === 1 ? 'credit' : 'credits'}`
}

export function registrationSummaryDisplay(
  course: CourseSummaryDto
): RegistrationSummaryDisplay | null {
  const summary = course.registrationSummary
  if (!summary || summary.total === 0) return null

  const available = summary.open + summary.restricted
  let primary = `${summary.total} sections`
  let detail = 'Status unavailable'
  let tone: RegistrationSummaryDisplay['tone'] = 'muted'

  if (summary.open > 0) {
    primary = `${summary.open} open`
    detail =
      summary.restricted > 0
        ? `${summary.restricted} restricted · ${summary.total} total`
        : `${summary.total} total sections`
    tone = 'success'
  } else if (available > 0) {
    primary = `${summary.restricted} restricted`
    detail = `${summary.total} total sections`
    tone = 'warning'
  } else if (summary.waitlisted > 0) {
    primary = `${summary.waitlisted} waitlisted`
    detail = `${summary.total} total sections`
    tone = 'warning'
  } else if (summary.closed + summary.cancelled === summary.total) {
    primary = 'No open sections'
    detail = `${summary.total} closed or cancelled`
    tone = 'destructive'
  }

  return {
    primary,
    detail,
    tone,
    updated:
      typeof summary.lastSynced === 'number'
        ? formatSnapshotTime(summary.lastSynced)
        : 'Freshness not fully known',
  }
}

function formatSnapshotTime(timestampSeconds: number): string {
  const date = new Date(timestampSeconds * 1000)
  if (Number.isNaN(date.getTime())) return 'Update time unavailable'
  return `All checked since ${date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })}`
}
