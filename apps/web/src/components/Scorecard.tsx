import { Paper, Group, Stack, Text, Title, RingProgress } from '@mantine/core'
import { getLetterGrade, getGradeColor } from '../utils/grading'
import { DIFFICULTY } from '../config/constants'

interface ScorecardProps {
  qualityScore: number | null
  difficultyScore: number | null
}

export function Scorecard({ qualityScore, difficultyScore }: ScorecardProps) {
  const grade = qualityScore !== null ? getLetterGrade(qualityScore) : 'N/A'
  const color = getGradeColor(grade)

  // Explicit check for null/undefined to handle 0 correctly
  const hasDifficulty = difficultyScore !== null && difficultyScore !== undefined

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
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" align="center">
        <Stack gap={0}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
            Overall Quality
          </Text>
          <Title order={2} fz={42} c={color === 'gray' ? 'dimmed' : color}>
            {grade}
          </Title>
        </Stack>

        <RingProgress
          size={80}
          thickness={8}
          roundCaps
          sections={[{ value: difficultyScore || 0, color: difficultyColor }]}
          label={
            <Text c={difficultyColor} fw={700} ta="center" size="xs">
              {difficultyLabel}
            </Text>
          }
          aria-label={`Difficulty: ${difficultyLabel}`}
        />
      </Group>

      <Group gap="xs" mt="md">
         <Text size="xs" c="dimmed">
             {qualityScore !== null
                ? `Based on composite quality score of ${qualityScore.toFixed(1)}`
                : 'Insufficient data for quality score'}
         </Text>
      </Group>
    </Paper>
  )
}
