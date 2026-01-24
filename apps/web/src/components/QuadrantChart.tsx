import { useMemo } from 'react'
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import type { TooltipProps } from 'recharts'
import { Paper, Text, Stack } from '@mantine/core'

interface QuadrantChartProps {
  currentCourse: {
    code: string
    quality: number | null
    difficulty: number | null
  }
  // Optional: Context courses (e.g., others in dept)
  contextCourses?: Array<{
    code: string
    quality: number
    difficulty: number
  }>
}

// Custom tooltip component defined outside to prevent re-renders
const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload

    // Defensive helpers
    const fmt = (val: any) => (typeof val === 'number' ? val.toFixed(1) : 'N/A')

    return (
      <Paper p="xs" shadow="sm" withBorder>
        <Text fw={700} size="sm">{data.code}</Text>
        <Text size="xs">Quality: {fmt(data.quality)}</Text>
        <Text size="xs">Difficulty: {fmt(data.difficulty)}</Text>
      </Paper>
    )
  }
  return null
}

export function QuadrantChart({ currentCourse, contextCourses = [] }: QuadrantChartProps) {
  // Memoize data to prevent unnecessary re-calculations
  const data = useMemo(() => {
    const points = []

    // Only add current course if it has valid data
    if (typeof currentCourse.quality === 'number' && typeof currentCourse.difficulty === 'number') {
      points.push({ ...currentCourse, type: 'current', z: 100 })
    }

    // Add context courses
    points.push(...contextCourses.map(c => ({ ...c, type: 'context', z: 10 })))

    return points
  }, [currentCourse, contextCourses])

  const contextData = useMemo(() => data.filter(d => d.type === 'context'), [data])
  const currentData = useMemo(() => data.filter(d => d.type === 'current'), [data])

  if (data.length === 0) {
    return (
      <Stack gap="xs" align="center" justify="center" h={250} bg="gray.0" style={{ borderRadius: 8 }}>
        <Text c="dimmed" size="sm">No rating data available for chart</Text>
      </Stack>
    )
  }

  return (
    <Stack gap="xs">
      <Text size="sm" fw={500} ta="center" id="chart-title">Difficulty vs. Quality</Text>
      <div style={{ width: '100%', height: 250, minWidth: 0 }} role="img" aria-labelledby="chart-title">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 10, right: 10, bottom: 20, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              type="number"
              dataKey="difficulty"
              name="Difficulty"
              domain={[0, 100]}
              label={{ value: 'Difficulty (Easy → Hard)', position: 'bottom', offset: 0, fontSize: 12 }}
              tick={{ fontSize: 10 }}
            />
            <YAxis
              type="number"
              dataKey="quality"
              name="Quality"
              domain={[0, 100]}
              label={{ value: 'Quality', angle: -90, position: 'insideLeft', fontSize: 12, offset: 10 }}
              tick={{ fontSize: 10 }}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: '3 3' }} />

            {/* Quadrant Lines */}
            <ReferenceLine x={50} stroke="#ced4da" strokeDasharray="3 3" />
            <ReferenceLine y={50} stroke="#ced4da" strokeDasharray="3 3" />

            <Scatter
              name="Context"
              data={contextData}
              fill="#adb5bd"
              shape="circle"
              isAnimationActive={false}
            />

            <Scatter
              name="Current"
              data={currentData}
              fill="#228be6"
              shape="circle"
              isAnimationActive={false}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </Stack>
  )
}
