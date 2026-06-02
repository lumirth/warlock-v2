import { Table, Badge, Text, Group, Stack, Anchor } from '@mantine/core'
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
    ? section.instructor.split(';').map((name) => name.trim()).filter(Boolean)
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

function getRmpHref(stat: InstructorLinkDto, fallbackName: string): string | null {
  return stat.rmp_url
    ?? buildRmpProfessorUrl(stat.rmp_id)
    ?? stat.rmp_search_url
    ?? buildRmpSearchUrl(stat.instructor_name ?? fallbackName)
}

export function SectionsTable({ sections, instructorLinks, courseExplorerUrl }: SectionsTableProps) {
  if (sections.length === 0) {
    return <Text c="dimmed" fs="italic">No sections found for this term.</Text>
  }

  const rows = sections.map((section) => {
    const sectionStats = getSectionStats(section, instructorLinks)
    const ratingStat = sectionStats.find((stat) => typeof stat.rmp_rating === 'number')
    const gpaStat = sectionStats.find((stat) => typeof stat.avg_gpa === 'number')
    const displayedRating = section.instructorRmp ?? ratingStat?.rmp_rating ?? null
    const displayedGpa = section.instructorGpa ?? gpaStat?.avg_gpa ?? null
    const displayedGpaSampleSize = gpaStat?.gpa_sample_size ?? null

    // Determine how to display instructors and their stats
    const renderInstructors = () => {
      if (!section.instructor || section.instructor === 'TBA') {
        return <Text size="sm" fw={500}>TBA</Text>;
      }

      // If we have enriched stats, use them
      if (sectionStats.length > 0) {
        return (
          <Stack gap={4}>
            {sectionStats.map((stat, idx) => (
              <Group key={`${stat.instructor_name ?? 'instructor'}-${idx}`} gap="xs" wrap="nowrap">
                {getRmpHref(stat, section.instructor.split(';')[idx]?.trim() ?? '') ? (
                  <Anchor
                    href={getRmpHref(stat, section.instructor.split(';')[idx]?.trim() ?? '') ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                    size="sm"
                    fw={500}
                    underline="hover"
                    title="Open Rate My Professors"
                  >
                    {stat.instructor_name || section.instructor.split(';')[idx]?.trim() || 'Instructor'}
                  </Anchor>
                ) : (
                  <Text size="sm" fw={500}>
                    {stat.instructor_name || section.instructor.split(';')[idx]?.trim() || 'Instructor'}
                  </Text>
                )}
              </Group>
            ))}
          </Stack>
        );
      }

      // Fallback: Split string if no stats
      return (
        <Stack gap={4}>
          {section.instructor.split(';').map((name, idx) => {
            const trimmedName = name.trim();
            const linkData = instructorLinks?.[trimmedName];
            const rmpHref = linkData ? getRmpHref(linkData, trimmedName) : buildRmpSearchUrl(trimmedName);
            return (
              <Group key={idx} gap="xs" wrap="nowrap">
                {rmpHref ? (
                  <Anchor
                    href={rmpHref}
                    target="_blank"
                    rel="noreferrer"
                    size="sm"
                    fw={500}
                    underline="hover"
                    title="Open Rate My Professors"
                  >
                    {trimmedName}
                  </Anchor>
                ) : (
                  <Text size="sm" fw={500}>{trimmedName}</Text>
                )}
              </Group>
            );
          })}
        </Stack>
      );
    };

    return (
      <Table.Tr key={section.crn}>
        <Table.Td>
          {renderInstructors()}
        </Table.Td>
        <Table.Td>
          {typeof displayedRating === 'number' ? (
            <Badge size="xs" color={displayedRating > RMP_THRESHOLDS.GOOD ? 'teal' : 'orange'}>
              {displayedRating.toFixed(1)} ★
            </Badge>
          ) : (
            <Text size="xs" c="dimmed">-</Text>
          )}
        </Table.Td>
        <Table.Td>
            {typeof displayedGpa === 'number' ? (
              <Stack gap={0}>
                <Text size="sm" fw={500}>{displayedGpa.toFixed(2)}</Text>
                {typeof displayedGpaSampleSize === 'number' && (
                  <Text size="xs" c="dimmed">{displayedGpaSampleSize.toLocaleString()} records</Text>
                )}
              </Stack>
            ) : (
                <Text size="xs" c="dimmed">-</Text>
            )}
        </Table.Td>
        <Table.Td>
          <Text size="sm">{section.days || 'Arranged'}</Text>
          <Text size="xs" c="dimmed">
            {section.startTime ? `${formatTime(section.startTime)} - ${formatTime(section.endTime)}` : ''}
          </Text>
        </Table.Td>
        <Table.Td>
          <Text size="sm">{section.location || 'TBA'}</Text>
        </Table.Td>
        <Table.Td style={{ width: '7.5rem', whiteSpace: 'nowrap' }}>
          <Badge
              size="sm"
              variant="light"
              color={section.status.toLowerCase().includes('open') ? 'green' : 'red'}
              style={{ maxWidth: 'none' }}
              tt="none"
          >
              {section.status}
          </Badge>
        </Table.Td>
        <Table.Td>
          {(section.course_explorer_url ?? courseExplorerUrl) ? (
            <Anchor
              href={section.course_explorer_url ?? courseExplorerUrl}
              target="_blank"
              rel="noreferrer"
              size="sm"
            >
              CRN {section.crn}
            </Anchor>
          ) : (
            <Text size="sm">CRN {section.crn}</Text>
          )}
        </Table.Td>
      </Table.Tr>
    )
  })

  return (
    <Table miw={700}>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Instructor</Table.Th>
          <Table.Th>Rating</Table.Th>
          <Table.Th>Avg GPA</Table.Th>
          <Table.Th>Time</Table.Th>
          <Table.Th>Location</Table.Th>
          <Table.Th>Status</Table.Th>
          <Table.Th>Official</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>{rows}</Table.Tbody>
    </Table>
  )
}
