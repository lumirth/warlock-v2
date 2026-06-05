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
  type CourseSectionDto,
  type InstructorLinkDto,
} from '@uiuc-course-search/query-types'
import { RMP_THRESHOLDS } from '../config/constants'
import {
  formatMeetingLocation,
  formatPartOfTerm,
  formatSectionDateRange,
  formatSectionLocation,
  formatSectionTimeRange,
  sectionAvailabilityTone,
  sectionInstructorStats,
  sectionRmpHref,
  splitSectionInstructorNames,
  type SectionTone,
} from './section-display-model'

interface SectionsTableProps {
  sections: CourseSectionDto[]
  instructorLinks?: Record<string, InstructorLinkDto>
  courseExplorerUrl?: string
}

function toneClass(tone: SectionTone): string {
  return cn(
    tone === 'success' && 'text-success',
    tone === 'warning' && 'text-warning',
    tone === 'destructive' && 'text-destructive',
    tone === 'muted' && 'text-muted-foreground'
  )
}

function statSummary(stat: InstructorLinkDto): string[] {
  const values: string[] = []
  if (typeof stat.rmpRating === 'number') {
    values.push(`${stat.rmpRating.toFixed(1)} rating`)
  }
  if (typeof stat.rmpDifficulty === 'number') {
    values.push(`${stat.rmpDifficulty.toFixed(1)} RMP difficulty`)
  }
  if (typeof stat.avgGpa === 'number') {
    values.push(`${stat.avgGpa.toFixed(2)} avg GPA`)
  }
  if (typeof stat.medianGpa === 'number') {
    values.push(`${stat.medianGpa.toFixed(2)} median GPA`)
  }
  if (typeof stat.wouldTakeAgainPct === 'number') {
    values.push(`${Math.round(stat.wouldTakeAgainPct)}% would take again`)
  }
  return values
}

function renderInstructorName(name: string, stat?: InstructorLinkDto) {
  const href = sectionRmpHref(stat, name)
  const label = stat?.instructorName ?? name

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
          stat: stats.find((item) => item.instructorName === name),
        }))
      : stats.map((stat) => ({
          name: stat.instructorName ?? 'Instructor',
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
          typeof stat?.rmpRating === 'number' &&
          stat.rmpRating > RMP_THRESHOLDS.GOOD
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
            {!compact && stat?.topTags && stat.topTags.length > 0 && (
              <span className="text-muted-foreground text-xs">
                Tags: {stat.topTags.slice(0, 3).join(', ')}
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
    { label: 'Part of term', value: formatPartOfTerm(section.schedule.partOfTerm) },
    { label: 'Dates', value: formatSectionDateRange(section) },
    { label: 'Credit hours', value: section.schedule.creditHours },
    {
      label: 'Status code',
      value: [
        section.availability.statusCode,
        section.availability.sectionStatusCode,
      ]
        .filter(Boolean)
        .join(' / '),
    },
    { label: 'CAPP area', value: section.sourceFacts.cappArea },
  ].filter((item): item is { label: string; value: string } =>
    Boolean(item.value)
  )

  const hasSectionText =
    section.sourceFacts.sectionText || section.sourceFacts.sectionNotes
  const hasDetails =
    detailFields.length > 0 ||
    hasSectionText ||
    section.sourceFacts.sectionTitle ||
    section.schedule.meetings.length > 0

  return (
    <div className="flex flex-col gap-4 py-2">
      {!hasDetails && (
        <p className="text-muted-foreground text-sm">
          No extra section detail rows are available for this section yet.
        </p>
      )}

      {section.sourceFacts.sectionTitle && (
        <div>
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Section title
          </p>
          <p className="mt-1 text-sm font-medium">
            {section.sourceFacts.sectionTitle}
          </p>
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
          {section.sourceFacts.sectionNotes && (
            <div>
              <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Section notes
              </p>
              <p className="mt-1 text-sm leading-6">
                {section.sourceFacts.sectionNotes}
              </p>
            </div>
          )}
          {section.sourceFacts.sectionText && (
            <div>
              <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Section text
              </p>
              <p className="mt-1 text-sm leading-6">
                {section.sourceFacts.sectionText}
              </p>
            </div>
          )}
        </div>
      )}

      {section.schedule.meetings.length > 0 ? (
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
              {section.schedule.meetings.map((meeting, idx) => (
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
                    {formatSectionTimeRange(meeting.startTime, meeting.endTime)}
                  </TableCell>
                  <TableCell>{formatMeetingLocation(meeting)}</TableCell>
                  <TableCell>
                    {meeting.dateRangeText || formatSectionDateRange(section) || '-'}
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
          const sectionStats = sectionInstructorStats(section, instructorLinks)
          const expanded = expandedCrns.has(section.crn)
          const officialUrl = section.links.courseExplorerUrl ?? courseExplorerUrl

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
                    className={cn(
                      'font-semibold',
                      toneClass(sectionAvailabilityTone(section.availability.status))
                    )}
                  >
                    {section.availability.label}
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
                <TableCell>{section.schedule.type || '-'}</TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span>{section.sectionNumber}</span>
                    {section.schedule.partOfTerm && (
                      <span className="text-muted-foreground text-xs">
                        {formatPartOfTerm(section.schedule.partOfTerm)}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {formatSectionTimeRange(
                    section.schedule.startTime,
                    section.schedule.endTime
                  )}
                </TableCell>
                <TableCell>{section.schedule.days || 'Arranged'}</TableCell>
                <TableCell>{formatSectionLocation(section)}</TableCell>
                <TableCell className="whitespace-normal">
                  <InstructorBlock
                    names={splitSectionInstructorNames(section)}
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
