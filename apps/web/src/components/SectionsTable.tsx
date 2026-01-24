import { Table, Badge, Text, Group, Stack, Anchor } from '@mantine/core'
import type { Section, InstructorLink } from '../lib/api-types'
import { formatTime } from '../utils/formatters'
import { RMP_THRESHOLDS } from '../config/constants'

interface SectionsTableProps {
  sections: Section[]
  instructorLinks?: Record<string, InstructorLink>
}

export function SectionsTable({ sections, instructorLinks }: SectionsTableProps) {
  if (sections.length === 0) {
    return <Text c="dimmed" fs="italic">No sections found for this term.</Text>
  }

  const rows = sections.map((section) => {
    // Determine how to display instructors and their stats
    const renderInstructors = () => {
      if (!section.instructor || section.instructor === 'TBA') {
        return <Text size="sm" fw={500}>TBA</Text>;
      }

      // If we have enriched stats, use them
      if (section.instructorStats && section.instructorStats.length > 0) {
        return (
          <Stack gap={4}>
            {section.instructorStats.map((stat, idx) => (
              <Group key={idx} gap="xs" wrap="nowrap">
                {stat.rmp_id ? (
                  <Anchor
                    href={`https://www.ratemyprofessors.com/professor/${stat.rmp_id}`}
                    target="_blank"
                    size="sm"
                    fw={500}
                    underline="hover"
                  >
                    {stat.instructor_name || section.instructor.split(';')[idx]?.trim() || 'Instructor'}
                  </Anchor>
                ) : (
                  <Text size="sm" fw={500}>
                    {stat.instructor_name || section.instructor.split(';')[idx]?.trim() || 'Instructor'}
                  </Text>
                )}
                {stat.rmp_rating && (
                  <Badge
                    size="xs"
                    variant="light"
                    color={stat.rmp_rating > RMP_THRESHOLDS.GOOD ? 'teal' : 'orange'}
                  >
                    {stat.rmp_rating.toFixed(1)} ★
                  </Badge>
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
            return (
              <Group key={idx} gap="xs" wrap="nowrap">
                {linkData?.rmp_id ? (
                  <Anchor
                    href={`https://www.ratemyprofessors.com/professor/${linkData.rmp_id}`}
                    target="_blank"
                    size="sm"
                    fw={500}
                    underline="hover"
                  >
                    {trimmedName}
                  </Anchor>
                ) : (
                  <Text size="sm" fw={500}>{trimmedName}</Text>
                )}
                {linkData?.rmp_rating && (
                  <Badge
                    size="xs"
                    variant="light"
                    color={linkData.rmp_rating > RMP_THRESHOLDS.GOOD ? 'teal' : 'orange'}
                  >
                    {linkData.rmp_rating.toFixed(1)} ★
                  </Badge>
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
           {typeof section.instructorRmp === 'number' ? (
               <Badge size="xs" color={section.instructorRmp > RMP_THRESHOLDS.GOOD ? 'teal' : 'orange'}>
                   {section.instructorRmp.toFixed(1)} ★
               </Badge>
           ) : (
               <Text size="xs" c="dimmed">-</Text>
           )}
        </Table.Td>
        <Table.Td>
            {typeof section.instructorGpa === 'number' ? (
                <Text size="sm" fw={500}>{section.instructorGpa.toFixed(2)}</Text>
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
        <Table.Td>
          <Badge
              size="sm"
              variant="dot"
              color={section.status.toLowerCase().includes('open') ? 'green' : 'red'}
          >
              {section.status}
          </Badge>
        </Table.Td>
      </Table.Tr>
    )
  })

  return (
    <Table>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Instructor</Table.Th>
          <Table.Th>Rating</Table.Th>
          <Table.Th>Avg GPA</Table.Th>
          <Table.Th>Time</Table.Th>
          <Table.Th>Location</Table.Th>
          <Table.Th>Status</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>{rows}</Table.Tbody>
    </Table>
  )
}
