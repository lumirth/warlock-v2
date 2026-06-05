import {
  getQualityTierLabel,
  getWorkloadTierLabel,
  type QualityTierLabel,
  type WorkloadTierLabel,
} from '@uiuc-course-search/query-types'

export type QualityLabel = QualityTierLabel
export type WorkloadLabel = WorkloadTierLabel

export function getQualityLabel(score: number): QualityLabel {
  return getQualityTierLabel(score) ?? 'Low'
}

export function getWorkloadLabel(score: number): WorkloadLabel {
  return getWorkloadTierLabel(score) ?? 'Easy'
}

export function getQualityTone(
  label: QualityLabel | 'N/A'
): 'success' | 'warning' | 'destructive' | 'muted' {
  if (label === 'N/A') return 'muted'
  if (label === 'Excellent' || label === 'Good') return 'success'
  if (label === 'Fair') return 'warning'
  return 'destructive'
}

export function getWorkloadTone(
  label: WorkloadLabel | 'N/A'
): 'success' | 'warning' | 'destructive' | 'muted' {
  if (label === 'N/A') return 'muted'
  if (label === 'Hard') return 'destructive'
  if (label === 'Moderate') return 'warning'
  return 'success'
}
