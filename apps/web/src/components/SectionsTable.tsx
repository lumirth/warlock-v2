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
  type InstructorLinkDto,
} from '@uiuc-course-search/query-types'
import { formatTime } from '../utils/formatters'
import { RMP_THRESHOLDS } from '../config/constants'

interface SectionsTableProps {
  sections: CourseSectionDto[]
  instructorLinks?: Record<string, InstructorLinkDto>
  courseExplorerUrl?: string
}

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
  stat: InstructorLinkDto,
  fallbackName: string
): string | null {
  return (
    stat.rmp_url ??
    buildRmpProfessorUrl(stat.rmp_id) ??
    stat.rmp_search_url ??
    buildRmpSearchUrl(stat.instructor_name ?? fallbackName)
  )
}

export function SectionsTable({
  sections,
  instructorLinks,
  courseExplorerUrl,
}: SectionsTableProps) {
  if (sections.length === 0) {
    return (
      <p className="text-muted-foreground text-sm italic">
        No sections found for this term.
      </p>
    )
  }

  const rows = sections.map((section) => {
    const sectionStats = getSectionStats(section, instructorLinks)
    const ratingStat = sectionStats.find(
      (stat) => typeof stat.rmp_rating === 'number'
    )
    const gpaStat = sectionStats.find(
      (stat) => typeof stat.avg_gpa === 'number'
    )
    const displayedRating =
      section.instructorRmp ?? ratingStat?.rmp_rating ?? null
    const displayedGpa = section.instructorGpa ?? gpaStat?.avg_gpa ?? null
    const displayedGpaSampleSize = gpaStat?.gpa_sample_size ?? null

    // Determine how to display instructors and their stats
    const renderInstructors = () => {
      if (!section.instructor || section.instructor === 'TBA') {
        return <span className="text-sm font-medium">TBA</span>
      }

      // If we have enriched stats, use them
      if (sectionStats.length > 0) {
        return (
          <div className="flex flex-col gap-1">
            {sectionStats.map((stat, idx) => (
              <div
                key={`${stat.instructor_name ?? 'instructor'}-${idx}`}
                className="flex items-center gap-2"
              >
                {getRmpHref(
                  stat,
                  section.instructor.split(';')[idx]?.trim() ?? ''
                ) ? (
                  <a
                    href={
                      getRmpHref(
                        stat,
                        section.instructor.split(';')[idx]?.trim() ?? ''
                      ) ?? undefined
                    }
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-medium underline-offset-4 hover:underline"
                    title="Open Rate My Professors"
                  >
                    {stat.instructor_name ||
                      section.instructor.split(';')[idx]?.trim() ||
                      'Instructor'}
                  </a>
                ) : (
                  <span className="text-sm font-medium">
                    {stat.instructor_name ||
                      section.instructor.split(';')[idx]?.trim() ||
                      'Instructor'}
                  </span>
                )}
              </div>
            ))}
          </div>
        )
      }

      // Fallback: Split string if no stats
      return (
        <div className="flex flex-col gap-1">
          {section.instructor.split(';').map((name, idx) => {
            const trimmedName = name.trim()
            const linkData = instructorLinks?.[trimmedName]
            const rmpHref = linkData
              ? getRmpHref(linkData, trimmedName)
              : buildRmpSearchUrl(trimmedName)
            return (
              <div key={idx} className="flex items-center gap-2">
                {rmpHref ? (
                  <a
                    href={rmpHref}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-medium underline-offset-4 hover:underline"
                    title="Open Rate My Professors"
                  >
                    {trimmedName}
                  </a>
                ) : (
                  <span className="text-sm font-medium">{trimmedName}</span>
                )}
              </div>
            )
          })}
        </div>
      )
    }

    return (
      <TableRow key={section.crn}>
        <TableCell>{renderInstructors()}</TableCell>
        <TableCell>
          {typeof displayedRating === 'number' ? (
            <span
              className={cn(
                'text-sm font-semibold',
                displayedRating > RMP_THRESHOLDS.GOOD
                  ? 'text-success'
                  : 'text-warning'
              )}
            >
              {displayedRating.toFixed(1)} ★
            </span>
          ) : (
            <span className="text-muted-foreground text-xs">-</span>
          )}
        </TableCell>
        <TableCell>
          {typeof displayedGpa === 'number' ? (
            <div className="flex flex-col">
              <span className="text-sm font-medium">
                {displayedGpa.toFixed(2)}
              </span>
              {typeof displayedGpaSampleSize === 'number' && (
                <span className="text-muted-foreground text-xs">
                  {displayedGpaSampleSize.toLocaleString()} records
                </span>
              )}
            </div>
          ) : (
            <span className="text-muted-foreground text-xs">-</span>
          )}
        </TableCell>
        <TableCell>
          <div className="text-sm">{section.days || 'Arranged'}</div>
          <div className="text-muted-foreground text-xs">
            {section.startTime
              ? `${formatTime(section.startTime)} - ${formatTime(section.endTime)}`
              : ''}
          </div>
        </TableCell>
        <TableCell>
          <span className="text-sm">{section.location || 'TBA'}</span>
        </TableCell>
        <TableCell className="w-32">
          <span
            className={cn(
              'text-sm font-semibold',
              section.status.toLowerCase().includes('open')
                ? 'text-success'
                : 'text-destructive'
            )}
          >
            {section.status}
          </span>
        </TableCell>
        <TableCell>
          {(section.course_explorer_url ?? courseExplorerUrl) ? (
            <a
              href={section.course_explorer_url ?? courseExplorerUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm underline-offset-4 hover:underline"
            >
              CRN {section.crn}
            </a>
          ) : (
            <span className="text-sm">CRN {section.crn}</span>
          )}
        </TableCell>
      </TableRow>
    )
  })

  return (
    <Table className="min-w-[700px]">
      <TableHeader>
        <TableRow>
          <TableHead>Instructor</TableHead>
          <TableHead>Rating</TableHead>
          <TableHead>Avg GPA</TableHead>
          <TableHead>Time</TableHead>
          <TableHead>Location</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Official</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>{rows}</TableBody>
    </Table>
  )
}
