import { ChevronDownIcon, ExternalLinkIcon } from 'lucide-react'
import type { CourseInstructorDto, CourseSectionDto } from '@warlock-v2/query-types'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import {
  formatMeetingLocation,
  formatPartOfTerm,
  formatSectionDateRange,
  formatSectionLocation,
  formatSectionTimeRange,
  sectionAvailabilityTone,
} from './section-display-model'

const toneClass = {
  success: 'text-success',
  warning: 'text-warning',
  destructive: 'text-destructive',
  muted: 'text-muted-foreground',
}

function instructorStats(instructor: CourseInstructorDto) {
  return [
    typeof instructor.rmpRating === 'number' && `RMP ${instructor.rmpRating.toFixed(1)} / 5${typeof instructor.numRatings === 'number' ? ` (${instructor.numRatings.toLocaleString()} ratings)` : ''}`,
    typeof instructor.rmpDifficulty === 'number' && `${instructor.rmpDifficulty.toFixed(1)} / 5 difficulty`,
    typeof instructor.avgGpa === 'number' && `${instructor.avgGpa.toFixed(2)} avg GPA${typeof instructor.gpaSampleSize === 'number' ? ` (${instructor.gpaSampleSize.toLocaleString()} records)` : ''}`,
    typeof instructor.wouldTakeAgainPct === 'number' && `${Math.round(instructor.wouldTakeAgainPct)}% would take again`,
  ].filter(Boolean)
}

function InstructorList({ instructors }: { instructors: CourseInstructorDto[] }) {
  if (!instructors.length) return <span className="text-muted-foreground text-sm">TBA</span>
  return <div className="flex min-w-52 flex-col gap-1">
    {instructors.map((instructor) => {
      const href = instructor.rmpUrl ?? instructor.rmpSearchUrl
      const stats = instructorStats(instructor)
      return <div key={instructor.name}>
        {href ? <a href={href} target="_blank" rel="noreferrer" className="font-medium hover:underline">{instructor.name}</a>
          : <span className="font-medium">{instructor.name}</span>}
        {stats.length > 0 && <p className="text-muted-foreground text-xs">{stats.join(' / ')}</p>}
      </div>
    })}
  </div>
}

function SectionDetails({ section }: { section: CourseSectionDto }) {
  const facts = [
    ['Part of term', formatPartOfTerm(section.schedule.partOfTerm)],
    ['Dates', formatSectionDateRange(section)],
    ['Credit hours', section.schedule.creditHours],
    ['Status code', [section.availability.statusCode, section.availability.sectionStatusCode].filter(Boolean).join(' / ')],
    ['CAPP area', section.sourceFacts.cappArea],
  ].filter((item): item is [string, string] => Boolean(item[1]))

  return <div className="flex flex-col gap-4 border-t p-4">
    {section.links.courseExplorerUrl && <a
      href={section.links.courseExplorerUrl}
      target="_blank"
      rel="noreferrer"
      className="text-primary inline-flex w-fit items-center gap-1 text-sm font-medium hover:underline"
    >Official listing for CRN {section.crn}<ExternalLinkIcon className="size-3" aria-hidden /></a>}
    {section.sourceFacts.sectionTitle && <p className="font-medium">{section.sourceFacts.sectionTitle}</p>}
    {facts.length > 0 && <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {facts.map(([label, value]) => <div key={label}>
        <dt className="text-muted-foreground text-xs font-medium uppercase">{label}</dt>
        <dd className="mt-1 text-sm">{value}</dd>
      </div>)}
    </dl>}
    {(section.sourceFacts.sectionNotes || section.sourceFacts.sectionText) && <div className="grid gap-3 lg:grid-cols-2">
      {section.sourceFacts.sectionNotes && <div><h4 className="text-muted-foreground text-xs font-medium uppercase">Section notes</h4><p className="mt-1 text-sm leading-6">{section.sourceFacts.sectionNotes}</p></div>}
      {section.sourceFacts.sectionText && <div><h4 className="text-muted-foreground text-xs font-medium uppercase">Section text</h4><p className="mt-1 text-sm leading-6">{section.sourceFacts.sectionText}</p></div>}
    </div>}
    {section.schedule.meetings.length ? <div>
      <h3 className="mb-2 text-sm font-semibold">Meeting details</h3>
      <Table scrollAreaLabel={`Meeting details for CRN ${section.crn}`} className="min-w-[780px]">
        <TableHeader><TableRow>
          {['Type', 'Day', 'Time', 'Location', 'Dates', 'Instructor'].map((label) => <TableHead key={label}>{label}</TableHead>)}
        </TableRow></TableHeader>
        <TableBody>{section.schedule.meetings.map((meeting, index) => <TableRow key={index}>
          <TableCell>{meeting.typeName || 'Meeting'}{meeting.typeCode && <p className="text-muted-foreground text-xs">{meeting.typeCode}</p>}</TableCell>
          <TableCell>{meeting.days || 'Arranged'}</TableCell>
          <TableCell>{formatSectionTimeRange(meeting.startTime, meeting.endTime)}</TableCell>
          <TableCell>{formatMeetingLocation(meeting)}</TableCell>
          <TableCell>{meeting.dateRangeText || formatSectionDateRange(section) || '-'}</TableCell>
          <TableCell className="whitespace-normal"><InstructorList instructors={meeting.instructors} /></TableCell>
        </TableRow>)}</TableBody>
      </Table>
    </div> : <p className="text-muted-foreground text-sm">Meeting details are not available for this section.</p>}
  </div>
}

export function SectionsTable({ sections }: { sections: CourseSectionDto[] }) {
  if (!sections.length) return <p className="text-muted-foreground p-5 text-sm">No sections found for this term.</p>

  return <div className="divide-y">
    {sections.map((section) => {
      const tone = sectionAvailabilityTone(section.availability.status)
      return <details key={section.crn} className="group">
        <summary className="hover:bg-muted/50 grid cursor-pointer list-none gap-3 p-4 sm:grid-cols-[1fr_1fr_1fr] xl:grid-cols-[5rem_5rem_8rem_1fr_1fr_1.5fr]">
          <span className="flex items-center gap-1 font-medium"><ChevronDownIcon className="size-4 transition-transform group-open:rotate-180" aria-hidden />{section.crn}</span>
          <Badge variant="outline" className={cn('font-semibold', toneClass[tone])}>{section.availability.label}</Badge>
          <span>{section.schedule.type || 'Section'} {section.sectionNumber}</span>
          <span>{section.schedule.days || 'Arranged'} · {formatSectionTimeRange(section.schedule.startTime, section.schedule.endTime)}</span>
          <span>{formatSectionLocation(section)}</span>
          <InstructorList instructors={section.instructors} />
        </summary>
        <SectionDetails section={section} />
      </details>
    })}
  </div>
}
