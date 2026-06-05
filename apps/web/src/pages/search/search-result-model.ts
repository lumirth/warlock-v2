import {
  canonicalRequirementCode,
  getWorkloadTierLabel,
  type CourseRequirementDto,
  type CourseSummaryDto,
  type SearchChipDto,
  type SearchRecoveryGroup,
} from '@uiuc-course-search/query-types'
import { getQualityLabel, getQualityTone } from '../../utils/grading'
import { cn } from '@/lib/utils'

export type Tone = 'success' | 'warning' | 'destructive' | 'muted'

export type CourseResultMetric = {
  label: string
  value: string
  tone?: Tone
  title?: string
}

export function getWorkloadLabel(score: number): string {
  return getWorkloadTierLabel(score) ?? 'Easy'
}

export function getWorkloadTone(score: number): Tone {
  const label = getWorkloadTierLabel(score)
  if (label === 'Hard') return 'destructive'
  if (label === 'Moderate') return 'warning'
  return 'success'
}

export function toneTextClass(tone?: Tone): string {
  return cn(
    tone === 'success' && 'text-success',
    tone === 'warning' && 'text-warning',
    tone === 'destructive' && 'text-destructive',
    tone === 'muted' && 'text-muted-foreground'
  )
}

export function getCourseKey(course: CourseSummaryDto): string {
  return (
    course.id ||
    `${course.subject}-${course.number}-${course.term}-${course.year}`
  )
}

export function getCoursePath(course: CourseSummaryDto): string {
  return `/course/${course.subject}/${course.number}?term=${course.term}&year=${course.year}`
}

export function getCourseMetrics(course: CourseSummaryDto): CourseResultMetric[] {
  const qualityScore = course.metrics.qualityScore
  const workloadScore = course.metrics.workloadScore
  const primaryInstructorRmp = course.metrics.primaryInstructorRating
  const avgGpa = course.metrics.avgGpa
  const stats: CourseResultMetric[] = []

  if (typeof qualityScore === 'number') {
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
  if (typeof workloadScore === 'number') {
    stats.push({
      label: 'Workload',
      value: getWorkloadLabel(workloadScore),
      tone: getWorkloadTone(workloadScore),
    })
  }
  if (typeof primaryInstructorRmp === 'number') {
    stats.push({ label: 'Instructor', value: primaryInstructorRmp.toFixed(1) })
  }
  if (typeof avgGpa === 'number') {
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
    chip.removable && 'border-border bg-secondary text-secondary-foreground',
    chip.type === 'semantic' && 'text-muted-foreground',
    chip.type === 'assumption' && 'text-muted-foreground'
  )
}

export function formatTermLabel(term: string, year: number): string {
  return `${term.charAt(0).toUpperCase()}${term.slice(1).toLowerCase()} ${year}`
}

export function requirementLabel(requirement: CourseRequirementDto): string {
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
  return typeof value === 'number' ? value.toFixed(digits) : '-'
}

export function formatCredits(value: number | null): string {
  return typeof value === 'number' ? String(value) : '-'
}

export function recoveryButtonLabel(group: SearchRecoveryGroup): string {
  return group.label.startsWith('Show ') ? group.label : `Try: ${group.label}`
}
