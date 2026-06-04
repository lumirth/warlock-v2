import { Fragment, useState } from 'react'
import { ChevronDownIcon, ExternalLinkIcon } from 'lucide-react'
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
import { cn } from '@/lib/utils'
import {
  buildRmpProfessorUrl,
  buildRmpSearchUrl,
  type CourseSectionDto,
  type CourseSectionMeetingDto,
  type InstructorLinkDto,
} from '@uiuc-course-search/query-types'
import { formatTime } from '../utils/formatters'
import { RMP_THRESHOLDS } from '../config/constants'

interface SectionsTableProps {
  sections: CourseSectionDto[]
  instructorLinks?: Record<string, InstructorLinkDto>
  courseExplorerUrl?: string
}

type Tone = 'success' | 'warning' | 'destructive' | 'muted'

function splitInstructorNames(section: CourseSectionDto): string[] {
  return section.instructor
    ? section.instructor
        .split(';')
        .map((name) => name.trim())
        .filter(Boolean)
    : []
}

function getSectionStats(
  section: CourseSectionDto,
  instructorLinks?: Record<string, InstructorLinkDto>
): InstructorLinkDto[] {
  if (section.instructorStats.length > 0) {
    return section.instructorStats
  }

  return splitInstructorNames(section)
    .map((name) => instructorLinks?.[name])
    .filter((stat): stat is InstructorLinkDto => Boolean(stat))
}

function getRmpHref(
  stat: InstructorLinkDto | undefined,
  fallbackName: string
): string | null {
  return (
    stat?.rmp_url ??
    buildRmpProfessorUrl(stat?.rmp_id) ??
    stat?.rmp_search_url ??
    buildRmpSearchUrl(fallbackName || stat?.instructor_name)
  )
}

function toneClass(tone: Tone): string {
  return cn(
    tone === 'success' && 'text-success',
    tone === 'warning' && 'text-warning',
    tone === 'destructive' && 'text-destructive',
    tone === 'muted' && 'text-muted-foreground'
  )
}

function statusTone(status: string): Tone {
  const normalized = status.toLowerCase()
  if (normalized.includes('open')) return 'success'
  if (normalized.includes('wait') || normalized.includes('restricted')) {
    return 'warning'
  }
  if (normalized.includes('closed') || normalized.includes('cancel')) {
    return 'destructive'
  }
  return 'muted'
}

function formatTimeRange(startTime: string | null, endTime: string | null): string {
  if (!startTime && !endTime) return 'ARRANGED'
  if (!endTime) return formatTime(startTime)
  return `${formatTime(startTime)} - ${formatTime(endTime)}`
}

function formatDate(value: string | null): string | null {
  if (!value) return null
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatDateRange(section: CourseSectionDto): string | null {
  if (section.dateRangeText) return section.dateRangeText
  const start = formatDate(section.startDate)
  const end = formatDate(section.endDate)
  if (start && end) return `${start} - ${end}`
  return start ?? end
}

function formatPartOfTerm(partOfTerm: string | null): string | null {
  if (!partOfTerm) return null
  const normalized = partOfTerm.toUpperCase()
  if (normalized === '1') return 'Full term (1)'
  if (normalized === 'A') return 'First half (A)'
  if (normalized === 'B') return 'Second half (B)'
  return `Part ${partOfTerm}`
}

function formatLocation(section: CourseSectionDto): string {
  return section.location || 'TBA'
}

function formatMeetingLocation(meeting: CourseSectionMeetingDto): string {
  const location = [meeting.buildingName, meeting.roomNumber]
    .filter(Boolean)
    .join(' ')
    .trim()
  return location || 'TBA'
}

function statSummary(stat: InstructorLinkDto): string[] {
  const values: string[] = []
  if (typeof stat.rmp_rating === 'number') {
    values.push(`${stat.rmp_rating.toFixed(1)} rating`)
  }
  if (typeof stat.rmp_difficulty === 'number') {
    values.push(`${stat.rmp_difficulty.toFixed(1)} RMP difficulty`)
  }
  if (typeof stat.avg_gpa === 'number') {
    values.push(`${stat.avg_gpa.toFixed(2)} avg GPA`)
  }
  if (typeof stat.median_gpa === 'number') {
    values.push(`${stat.median_gpa.toFixed(2)} median GPA`)
  }
  if (typeof stat.would_take_again_pct === 'number') {
    values.push(`${Math.round(stat.would_take_again_pct)}% would take again`)
  }
  return values
}

function renderInstructorName(name: string, stat?: InstructorLinkDto) {
  const href = getRmpHref(stat, name)
  const label = stat?.instructor_name ?? name

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="font-medium underline-offset-4 hover:underline"
      >
        {label}
      </a>
    )
  }

  return <span className="font-medium">{label}</span>
}

function InstructorBlock({
  names,
  stats,
  compact = false,
}: {
  names: string[]
  stats: InstructorLinkDto[]
  compact?: boolean
}) {
  const rows =
    names.length > 0
      ? names.map((name) => ({
          name,
          stat: stats.find((item) => item.instructor_name === name),
        }))
      : stats.map((stat) => ({
          name: stat.instructor_name ?? 'Instructor',
          stat,
        }))

  if (rows.length === 0) {
    return <span className="text-muted-foreground text-sm">TBA</span>
  }

  return (
    <div className="flex min-w-56 flex-col gap-1">
      {rows.map(({ name, stat }, idx) => {
        const statsText = stat ? statSummary(stat) : []
        const ratingTone =
          typeof stat?.rmp_rating === 'number' &&
          stat.rmp_rating > RMP_THRESHOLDS.GOOD
            ? 'success'
            : 'warning'

        return (
          <div key={`${name}-${idx}`} className="flex flex-col gap-0.5">
            <span className="text-sm">
              {renderInstructorName(name, stat)}
            </span>
            {statsText.length > 0 && (
              <span
                className={cn(
                  'text-xs',
                  compact ? 'text-muted-foreground' : toneClass(ratingTone)
                )}
              >
                {statsText.join(' / ')}
              </span>
            )}
            {!compact && stat?.top_tags && stat.top_tags.length > 0 && (
              <span className="text-muted-foreground text-xs">
                Tags: {stat.top_tags.slice(0, 3).join(', ')}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {label}
      </dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  )
}

function SectionDetails({
  section,
  sectionStats,
}: {
  section: CourseSectionDto
  sectionStats: InstructorLinkDto[]
}) {
  const detailFields = [
    { label: 'Part of term', value: formatPartOfTerm(section.partOfTerm) },
    { label: 'Dates', value: formatDateRange(section) },
    { label: 'Credit hours', value: section.creditHours },
    {
      label: 'Status code',
      value: [section.statusCode, section.sectionStatusCode]
        .filter(Boolean)
        .join(' / '),
    },
    { label: 'CAPP area', value: section.cappArea },
  ].filter((item): item is { label: string; value: string } =>
    Boolean(item.value)
  )

  const hasSectionText = section.sectionText || section.sectionNotes
  const hasDetails =
    detailFields.length > 0 ||
    hasSectionText ||
    section.sectionTitle ||
    section.meetings.length > 0

  return (
    <div className="flex flex-col gap-4 py-2">
      {!hasDetails && (
        <p className="text-muted-foreground text-sm">
          No extra section detail rows are available for this section yet.
        </p>
      )}

      {section.sectionTitle && (
        <div>
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Section title
          </p>
          <p className="mt-1 text-sm font-medium">{section.sectionTitle}</p>
        </div>
      )}

      {detailFields.length > 0 && (
        <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {detailFields.map((item) => (
            <DetailField
              key={item.label}
              label={item.label}
              value={item.value}
            />
          ))}
        </dl>
      )}

      {hasSectionText && (
        <div className="grid gap-3 lg:grid-cols-2">
          {section.sectionNotes && (
            <div>
              <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Section notes
              </p>
              <p className="mt-1 text-sm leading-6">{section.sectionNotes}</p>
            </div>
          )}
          {section.sectionText && (
            <div>
              <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Section text
              </p>
              <p className="mt-1 text-sm leading-6">{section.sectionText}</p>
            </div>
          )}
        </div>
      )}

      {section.meetings.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Meeting details</h3>
          <Table className="min-w-[780px]">
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Day</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead>Instructor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {section.meetings.map((meeting, idx) => (
                <TableRow key={`${section.crn}-meeting-${idx}`}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span>{meeting.typeName || 'Meeting'}</span>
                      {meeting.typeCode && (
                        <span className="text-muted-foreground text-xs">
                          {meeting.typeCode}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{meeting.days || 'Arranged'}</TableCell>
                  <TableCell>
                    {formatTimeRange(meeting.startTime, meeting.endTime)}
                  </TableCell>
                  <TableCell>{formatMeetingLocation(meeting)}</TableCell>
                  <TableCell>
                    {meeting.dateRangeText || formatDateRange(section) || '-'}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <InstructorBlock
                      names={meeting.instructorNames}
                      stats={
                        meeting.instructors.length > 0
                          ? meeting.instructors
                          : sectionStats
                      }
                      compact
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          Meeting-level rows are not available for this section yet.
        </p>
      )}
    </div>
  )
}

export function SectionsTable({
  sections,
  instructorLinks,
  courseExplorerUrl,
}: SectionsTableProps) {
  const [expandedCrns, setExpandedCrns] = useState<Set<string>>(new Set())

  if (sections.length === 0) {
    return (
      <p className="text-muted-foreground text-sm italic">
        No sections found for this term.
      </p>
    )
  }

  function toggleCrn(crn: string) {
    setExpandedCrns((current) => {
      const next = new Set(current)
      if (next.has(crn)) {
        next.delete(crn)
      } else {
        next.add(crn)
      }
      return next
    })
  }

  return (
    <Table className="min-w-[1050px]">
      <TableHeader>
        <TableRow>
          <TableHead className="w-14">Detail</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>CRN</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Section</TableHead>
          <TableHead>Time</TableHead>
          <TableHead>Day</TableHead>
          <TableHead>Location</TableHead>
          <TableHead>Instructor</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sections.map((section) => {
          const sectionStats = getSectionStats(section, instructorLinks)
          const expanded = expandedCrns.has(section.crn)
          const officialUrl = section.course_explorer_url ?? courseExplorerUrl

          return (
            <Fragment key={section.crn}>
              <TableRow aria-expanded={expanded}>
                <TableCell>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`${expanded ? 'Hide' : 'Show'} details for CRN ${section.crn}`}
                    aria-expanded={expanded}
                    onClick={() => toggleCrn(section.crn)}
                  >
                    <ChevronDownIcon
                      aria-hidden
                      className={cn(
                        'size-4 transition-transform motion-reduce:transition-none',
                        expanded && 'rotate-180'
                      )}
                    />
                  </Button>
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={cn('font-semibold', toneClass(statusTone(section.status)))}
                  >
                    {section.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  {officialUrl ? (
                    <a
                      href={officialUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`CRN ${section.crn}`}
                      className="inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
                    >
                      {section.crn}
                      <ExternalLinkIcon className="size-3" aria-hidden />
                    </a>
                  ) : (
                    <span className="text-sm font-medium">{section.crn}</span>
                  )}
                </TableCell>
                <TableCell>{section.type || '-'}</TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span>{section.sectionNumber}</span>
                    {section.partOfTerm && (
                      <span className="text-muted-foreground text-xs">
                        {formatPartOfTerm(section.partOfTerm)}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {formatTimeRange(section.startTime, section.endTime)}
                </TableCell>
                <TableCell>{section.days || 'Arranged'}</TableCell>
                <TableCell>{formatLocation(section)}</TableCell>
                <TableCell className="whitespace-normal">
                  <InstructorBlock
                    names={splitInstructorNames(section)}
                    stats={sectionStats}
                    compact
                  />
                </TableCell>
              </TableRow>
              {expanded && (
                <TableRow>
                  <TableCell colSpan={9} className="bg-muted/30 whitespace-normal">
                    <SectionDetails
                      section={section}
                      sectionStats={sectionStats}
                    />
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          )
        })}
      </TableBody>
    </Table>
  )
}
