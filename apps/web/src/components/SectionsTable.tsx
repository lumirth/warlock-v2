import { Table, Badge, Text, Group } from '@mantine/core'
import type { Section } from '../lib/api-types'
import { formatTime } from '../utils/formatters'
import { RMP_THRESHOLDS } from '../config/constants'

interface SectionsTableProps {
  sections: Section[]
}

export function SectionsTable({ sections }: SectionsTableProps) {
  if (sections.length === 0) {
    return <Text c="dimmed" fs="italic">No sections found for this term.</Text>
  }

  const rows = sections.map((section) => {
    return (
      <Table.Tr key={section.crn}>
        <Table.Td>
          <Group gap="xs">
             <Text size="sm" fw={500}>{section.instructor || 'TBA'}</Text>
             {section.instructorRmp !== null && (
                 <Badge size="xs" color={section.instructorRmp > RMP_THRESHOLDS.GOOD ? 'teal' : 'orange'}>
                     {section.instructorRmp.toFixed(1)} ★
                 </Badge>
             )}
          </Group>
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
        <Table.Td>
            {section.instructorGpa !== null ? (
                <Text size="sm" fw={500}>{section.instructorGpa.toFixed(2)}</Text>
            ) : (
                <Text size="xs" c="dimmed">-</Text>
            )}
        </Table.Td>
      </Table.Tr>
    )
  })

  return (
    <Table>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Instructor</Table.Th>
          <Table.Th>Time</Table.Th>
          <Table.Th>Location</Table.Th>
          <Table.Th>Status</Table.Th>
          <Table.Th>Avg GPA</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>{rows}</Table.Tbody>
    </Table>
  )
}
