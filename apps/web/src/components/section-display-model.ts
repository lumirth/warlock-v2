import {
  buildRmpProfessorUrl,
  buildRmpSearchUrl,
  type CourseSectionAvailabilityStatus,
  type CourseSectionDto,
  type CourseSectionMeetingDto,
  type InstructorLinkDto,
} from '@uiuc-course-search/query-types'
import { formatTime } from '../utils/formatters'

export type SectionTone = 'success' | 'warning' | 'destructive' | 'muted'

export function splitSectionInstructorNames(section: CourseSectionDto): string[] {
  return section.instructors.displayName
    ? section.instructors.displayName
        .split(';')
        .map((name) => name.trim())
        .filter(Boolean)
    : []
}

export function sectionInstructorStats(
  section: CourseSectionDto,
  instructorLinks?: Record<string, InstructorLinkDto>
): InstructorLinkDto[] {
  if (section.instructors.stats.length > 0) {
    return section.instructors.stats
  }

  return splitSectionInstructorNames(section)
    .map((name) => instructorLinks?.[name])
    .filter((stat): stat is InstructorLinkDto => Boolean(stat))
}

export function sectionAvailabilityTone(
  status: CourseSectionAvailabilityStatus
): SectionTone {
  if (status === 'open') return 'success'
  if (status === 'restricted' || status === 'waitlisted') return 'warning'
  if (status === 'closed' || status === 'cancelled') return 'destructive'
  return 'muted'
}

export function formatSectionTimeRange(
  startTime: string | null,
  endTime: string | null
): string {
  if (!startTime && !endTime) return 'ARRANGED'
  if (!endTime) return formatTime(startTime)
  return `${formatTime(startTime)} - ${formatTime(endTime)}`
}

export function formatSectionDateRange(section: CourseSectionDto): string | null {
  if (section.schedule.dateRangeText) return section.schedule.dateRangeText
  const start = formatSectionDate(section.schedule.startDate)
  const end = formatSectionDate(section.schedule.endDate)
  if (start && end) return `${start} - ${end}`
  return start ?? end
}

export function formatPartOfTerm(partOfTerm: string | null): string | null {
  if (!partOfTerm) return null
  const normalized = partOfTerm.toUpperCase()
  if (normalized === '1') return 'Full term (1)'
  if (normalized === 'A') return 'First half (A)'
  if (normalized === 'B') return 'Second half (B)'
  return `Part ${partOfTerm}`
}

export function formatSectionLocation(section: CourseSectionDto): string {
  return section.schedule.location || 'TBA'
}

export function formatMeetingLocation(meeting: CourseSectionMeetingDto): string {
  const location = [meeting.buildingName, meeting.roomNumber]
    .filter(Boolean)
    .join(' ')
    .trim()
  return location || 'TBA'
}

export function sectionRmpHref(
  stat: InstructorLinkDto | undefined,
  fallbackName: string
): string | null {
  return (
    stat?.rmpUrl ??
    buildRmpProfessorUrl(stat?.rmpId) ??
    stat?.rmpSearchUrl ??
    buildRmpSearchUrl(fallbackName || stat?.instructorName)
  )
}

function formatSectionDate(value: string | null): string | null {
  if (!value) return null
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
