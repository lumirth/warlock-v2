import {
  canonicalRequirementCode,
  type CourseRequirementDto,
  type SearchCourseResultDto,
  type CourseSummaryDto,
  type SearchChipDto,
} from '@uiuc-course-search/query-types'
import {
  getQualityLabel,
  getQualityTone,
  getWorkloadLabel,
  getWorkloadTone,
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
  return result.warnings?.some((warning) => warning.kind === 'historical') ?? false
}

export function getCourseMetrics(course: CourseSummaryDto): CourseResultMetric[] {
  const qualityScore = course.metrics.qualityScore
  const workloadScore = course.metrics.workloadScore
  const primaryInstructorRmp = course.metrics.primaryInstructorRating
  const avgGpa = course.metrics.avgGpa
  const stats: CourseResultMetric[] = []

  if (isFiniteMetric(qualityScore)) {
    const qualityLabel = getQualityLabel(qualityScore)
    stats.push({
      label: 'Quality',
      value: qualityLabel,
      tone: getQualityTone(qualityLabel),
      title:
        typeof course.metrics.gpaSampleSize === 'number'
          ? `Based on ${course.metrics.gpaSampleSize.toLocaleString()} records`
          : undefined,
    })
  }
  if (isFiniteMetric(workloadScore)) {
    stats.push({
      label: 'Workload',
      value: getWorkloadLabel(workloadScore),
      tone: getWorkloadTone(getWorkloadLabel(workloadScore)),
    })
  }
  if (isFiniteMetric(primaryInstructorRmp)) {
    stats.push({ label: 'Instructor', value: primaryInstructorRmp.toFixed(1) })
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
    chip.type === 'semantic' && 'text-muted-foreground',
  )
}

export function formatTermLabel(term: string, year: number): string {
  return `${term.charAt(0).toUpperCase()}${term.slice(1).toLowerCase()} ${year}`
}

function requirementLabel(requirement: CourseRequirementDto): string {
  const category = requirement.categoryName ?? requirement.categoryId
  if (requirement.attributeName) return `${category}: ${requirement.attributeName}`
  if (requirement.attributeCode) return `${category}: ${requirement.attributeCode}`
  return category
}

export function courseRequirementLabels(course: CourseSummaryDto): string[] {
  if (course.requirements.length > 0) {
    return course.requirements.map(requirementShortLabel)
  }
  return []
}

function requirementShortLabel(requirement: CourseRequirementDto): string {
  const categoryCode = canonicalRequirementCode(requirement.categoryId)
  const attributeCode = canonicalRequirementCode(requirement.attributeCode)

  if (categoryCode && attributeCode && categoryCode !== attributeCode) {
    return `${categoryCode}:${attributeCode}`
  }
  return attributeCode ?? categoryCode ?? requirementLabel(requirement)
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

export function formatCredits(value: number | null): string {
  return isFiniteMetric(value) ? String(value) : '-'
}
