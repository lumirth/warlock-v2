import {
  getQualityTierLabel,
  type QualityTierLabel,
} from '@uiuc-course-search/query-types'

export type QualityLabel = QualityTierLabel

export function getQualityLabel(score: number): QualityLabel {
  return getQualityTierLabel(score) ?? 'Low'
}

export function getQualityTone(
  label: QualityLabel | 'N/A'
): 'success' | 'warning' | 'destructive' | 'muted' {
  if (label === 'N/A') return 'muted'
  if (label === 'Excellent' || label === 'Good') return 'success'
  if (label === 'Fair') return 'warning'
  return 'destructive'
}
