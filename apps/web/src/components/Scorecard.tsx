import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import {
  getQualityLabel,
  getQualityTone,
  getInstructorDifficultyLabel,
  getInstructorDifficultyTone,
  isFiniteMetric,
  metricToneTextClass,
} from '../utils/grading'

interface ScorecardProps {
  qualityScore: number | null
  instructorDifficultyScore: number | null
  avgGpa?: number | null
  medianGpa?: number | null
  gpaSampleSize?: number | null
  primaryInstructorRmp?: number | null
}

export function Scorecard({
  qualityScore,
  instructorDifficultyScore,
  avgGpa,
  medianGpa,
  gpaSampleSize,
  primaryInstructorRmp,
}: ScorecardProps) {
  const qualityLabel = isFiniteMetric(qualityScore)
    ? getQualityLabel(qualityScore)
    : 'N/A'
  const qualityTone = getQualityTone(qualityLabel)

  const hasInstructorDifficulty = isFiniteMetric(instructorDifficultyScore)
  const hasAvgGpa = isFiniteMetric(avgGpa)
  const hasMedianGpa = isFiniteMetric(medianGpa)
  const hasPrimaryRating = isFiniteMetric(primaryInstructorRmp)

  const instructorDifficultyLabel = hasInstructorDifficulty
    ? getInstructorDifficultyLabel(instructorDifficultyScore)
    : 'N/A'

  const instructorDifficultyTone = getInstructorDifficultyTone(
    instructorDifficultyLabel
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Evidence-limited signals</CardTitle>
        <p className="text-muted-foreground text-xs leading-5">
          Historical GPA and linked Rate My Professors data. These are not
          official course evaluations.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <dl className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground text-sm">Quality signal</dt>
            <dd
              className={cn(
                'text-sm font-semibold',
                metricToneTextClass(qualityTone)
              )}
            >
              {qualityLabel}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground text-sm">
              Instructor difficulty
            </dt>
            <dd
              className={cn(
                'text-sm font-semibold',
                metricToneTextClass(instructorDifficultyTone)
              )}
            >
              {instructorDifficultyLabel}
            </dd>
          </div>
          {hasPrimaryRating && (
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground text-sm">RMP rating</dt>
              <dd className="text-sm font-semibold">
                {primaryInstructorRmp.toFixed(1)} / 5
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
                    {gpaSampleSize.toLocaleString()} GPA records
                  </span>
                )}
              </dd>
            </div>
          )}
          {hasMedianGpa && (
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground text-sm">Median GPA</dt>
              <dd className="text-sm font-semibold">{medianGpa.toFixed(2)}</dd>
            </div>
          )}
        </dl>

        <div className="text-muted-foreground border-t pt-3 text-xs leading-5">
          <p>
            Quality combines GPA and linked RMP evidence only when at least 30
            GPA records and 5 RMP ratings are available.
          </p>
          <p className="mt-1">
            Instructor difficulty comes from linked RMP data; it does not
            measure assigned work.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
