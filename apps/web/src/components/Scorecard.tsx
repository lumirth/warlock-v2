import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  getQualityLabel,
  getQualityTone,
  getWorkloadLabel,
  getWorkloadTone,
  isFiniteMetric,
  metricToneTextClass,
} from '../utils/grading'

interface ScorecardProps {
  qualityScore: number | null
  workloadScore: number | null
  avgGpa?: number | null
  medianGpa?: number | null
  gpaSampleSize?: number | null
  primaryInstructorRmp?: number | null
}

export function Scorecard({
  qualityScore,
  workloadScore,
  avgGpa,
  medianGpa,
  gpaSampleSize,
  primaryInstructorRmp,
}: ScorecardProps) {
  const qualityLabel = isFiniteMetric(qualityScore)
    ? getQualityLabel(qualityScore)
    : 'N/A'
  const qualityTone = getQualityTone(qualityLabel)

  const hasWorkload = isFiniteMetric(workloadScore)
  const hasAvgGpa = isFiniteMetric(avgGpa)
  const hasMedianGpa = isFiniteMetric(medianGpa)
  const hasPrimaryRating = isFiniteMetric(primaryInstructorRmp)

  const workloadLabel = hasWorkload ? getWorkloadLabel(workloadScore) : 'N/A'

  const workloadTone = getWorkloadTone(workloadLabel)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Course scores</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <dl className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground text-sm">Quality</dt>
            <dd className={cn('text-sm font-semibold', metricToneTextClass(qualityTone))}>
              {qualityLabel}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground text-sm">Workload</dt>
            <dd
              className={cn('text-sm font-semibold', metricToneTextClass(workloadTone))}
            >
              {workloadLabel}
            </dd>
          </div>
          {hasPrimaryRating && (
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground text-sm">
                Instructor rating
              </dt>
              <dd className="text-sm font-semibold">
                {primaryInstructorRmp.toFixed(1)}
              </dd>
            </div>
          )}
          {hasAvgGpa && (
            <div className="flex items-start justify-between gap-4">
              <dt className="text-muted-foreground text-sm">Average GPA</dt>
              <dd className="flex flex-col items-end">
                <span className="text-right text-sm font-semibold">
                  {avgGpa.toFixed(2)}
                </span>
                {typeof gpaSampleSize === 'number' && (
                  <span className="text-muted-foreground text-right text-xs">
                    {gpaSampleSize.toLocaleString()} records
                  </span>
                )}
              </dd>
            </div>
          )}
          {hasMedianGpa && (
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground text-sm">Median GPA</dt>
              <dd className="text-sm font-semibold">
                {medianGpa.toFixed(2)}
              </dd>
            </div>
          )}
        </dl>

        <Badge variant="outline" className="text-muted-foreground w-fit">
          {isFiniteMetric(qualityScore)
            ? typeof gpaSampleSize === 'number'
              ? `Based on ${gpaSampleSize.toLocaleString()} records`
              : 'Record count unavailable'
            : 'Not enough records for a quality label'}
        </Badge>
      </CardContent>
    </Card>
  )
}
