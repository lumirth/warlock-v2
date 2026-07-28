import {
  getQualityTierLabel,
  getInstructorDifficultyTierLabel,
  type QualityTierLabel,
  type InstructorDifficultyTierLabel,
} from '@uiuc-course-search/query-types'

type QualityLabel = QualityTierLabel
type InstructorDifficultyLabel = InstructorDifficultyTierLabel
export type MetricTone = 'success' | 'warning' | 'destructive' | 'muted'

export function isFiniteMetric(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function getQualityLabel(score: number): QualityLabel | 'N/A' {
  return getQualityTierLabel(score) ?? 'N/A'
}

export function getInstructorDifficultyLabel(
  score: number
): InstructorDifficultyLabel | 'N/A' {
  return getInstructorDifficultyTierLabel(score) ?? 'N/A'
}

export function getQualityTone(
  label: QualityLabel | 'N/A'
): MetricTone {
  if (label === 'N/A') return 'muted'
  if (label === 'Excellent' || label === 'Good') return 'success'
  if (label === 'Fair') return 'warning'
  return 'destructive'
}

export function getInstructorDifficultyTone(
  label: InstructorDifficultyLabel | 'N/A'
): MetricTone {
  if (label === 'N/A') return 'muted'
  if (label === 'Higher') return 'destructive'
  if (label === 'Moderate') return 'warning'
  return 'success'
}

export function metricToneTextClass(tone?: MetricTone): string {
  if (tone === 'success') return 'text-success'
  if (tone === 'warning') return 'text-warning'
  if (tone === 'destructive') return 'text-destructive'
  if (tone === 'muted') return 'text-muted-foreground'
  return ''
}
