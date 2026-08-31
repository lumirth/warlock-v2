import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import {
  getInstructorDifficultyLabel,
  getInstructorDifficultyTone,
  getQualityLabel,
  getQualityTone,
  isFiniteMetric,
  metricToneTextClass,
  type MetricTone,
} from '../utils/grading'

type Props = {
  qualityScore: number | null
  instructorDifficultyScore: number | null
  avgGpa?: number | null
  gpaSampleSize?: number | null
  primaryInstructorRmp?: number | null
}

export function Scorecard(props: Props) {
  const quality = isFiniteMetric(props.qualityScore) ? getQualityLabel(props.qualityScore) : 'N/A'
  const difficulty = isFiniteMetric(props.instructorDifficultyScore)
    ? getInstructorDifficultyLabel(props.instructorDifficultyScore) : 'N/A'
  const rows: Array<{ label: string; value: string; tone?: MetricTone; detail?: string }> = [
    { label: 'Quality signal', value: quality, tone: getQualityTone(quality) },
    { label: 'Instructor difficulty', value: difficulty, tone: getInstructorDifficultyTone(difficulty) },
  ]
  if (isFiniteMetric(props.primaryInstructorRmp)) rows.push({
    label: 'RMP rating', value: `${props.primaryInstructorRmp.toFixed(1)} / 5`,
  })
  if (isFiniteMetric(props.avgGpa)) rows.push({
    label: 'Average GPA', value: props.avgGpa.toFixed(2),
    detail: typeof props.gpaSampleSize === 'number' ? `${props.gpaSampleSize.toLocaleString()} records` : undefined,
  })
  return <Card>
    <CardHeader>
      <CardTitle>Evidence-limited signals</CardTitle>
      <p className="text-muted-foreground text-xs leading-5">Historical GPA and linked Rate My Professors data, not official evaluations.</p>
    </CardHeader>
    <CardContent>
      <dl className="flex flex-col gap-2">
        {rows.map((row) => <div key={row.label} className="flex items-start justify-between gap-4">
          <dt className="text-muted-foreground text-sm">{row.label}</dt>
          <dd className={cn('text-right text-sm font-semibold', metricToneTextClass(row.tone))}>
            {row.value}{row.detail && <small className="text-muted-foreground block font-normal">{row.detail}</small>}
          </dd>
        </div>)}
      </dl>
      <p className="text-muted-foreground mt-3 border-t pt-3 text-xs leading-5">
        Quality uses GPA and linked RMP evidence only with enough samples. Instructor difficulty is an RMP signal, not assigned work.
      </p>
    </CardContent>
  </Card>
}
