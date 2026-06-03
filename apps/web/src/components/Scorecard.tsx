import { Paper, Group, Stack, Text } from '@mantine/core'
import { getLetterGrade, getGradeColor } from '../utils/grading'
import { DIFFICULTY } from '../config/constants'

interface ScorecardProps {
  qualityScore: number | null
  difficultyScore: number | null
  avgGpa?: number | null
  gpaSampleSize?: number | null
  primaryInstructorRmp?: number | null
}

export function Scorecard({
  qualityScore,
  difficultyScore,
  avgGpa,
  gpaSampleSize,
  primaryInstructorRmp,
}: ScorecardProps) {
  const grade = qualityScore !== null ? getLetterGrade(qualityScore) : 'N/A'
  const color = getGradeColor(grade)

  // Explicit check for null/undefined to handle 0 correctly
  const hasDifficulty = difficultyScore !== null && difficultyScore !== undefined
  const hasAvgGpa = typeof avgGpa === 'number'
  const hasPrimaryRating = typeof primaryInstructorRmp === 'number'

  const difficultyLabel = !hasDifficulty
    ? 'N/A'
    : difficultyScore! > DIFFICULTY.HARD ? 'Hard'
    : difficultyScore! > DIFFICULTY.MODERATE ? 'Moderate'
    : 'Easy'

  const difficultyColor = !hasDifficulty
    ? 'gray'
    : difficultyScore! > DIFFICULTY.HARD ? 'red'
    : difficultyScore! > DIFFICULTY.MODERATE ? 'yellow'
    : 'teal'

  return (
    <Paper withBorder p="md" radius="md" shadow="none">
      <Stack gap="sm">
        <Text fw={600}>Course scores</Text>

        <Stack gap={6}>
          <Group justify="space-between" gap="md">
            <Text size="sm" c="dimmed">Quality</Text>
            <Text size="sm" fw={600} c={color === 'gray' ? 'dimmed' : color}>{grade}</Text>
          </Group>
          <Group justify="space-between" gap="md">
            <Text size="sm" c="dimmed">Workload</Text>
            <Text size="sm" fw={600} c={difficultyColor === 'gray' ? 'dimmed' : difficultyColor}>{difficultyLabel}</Text>
          </Group>
          {hasPrimaryRating && (
            <Group justify="space-between" gap="md">
              <Text size="sm" c="dimmed">Instructor rating</Text>
              <Text size="sm" fw={600}>{primaryInstructorRmp.toFixed(1)}</Text>
            </Group>
          )}
          {hasAvgGpa && (
            <Group justify="space-between" gap="md" align="flex-start">
              <Text size="sm" c="dimmed">Average GPA</Text>
              <Stack gap={0} align="flex-end">
                <Text size="sm" fw={600} ta="right">{avgGpa.toFixed(2)}</Text>
                {typeof gpaSampleSize === 'number' && (
                  <Text size="xs" c="dimmed" ta="right">{gpaSampleSize.toLocaleString()} records</Text>
                )}
              </Stack>
            </Group>
          )}
        </Stack>

        <Text size="xs" c="dimmed">
          {typeof qualityScore === 'number'
            ? `Based on composite quality score of ${qualityScore.toFixed(1)}`
            : 'Insufficient data for quality score'}
        </Text>
      </Stack>
    </Paper>
  )
}
