import { QUALITY } from '../config/constants'

export type QualityLabel = 'Excellent' | 'Good' | 'Fair' | 'Low'

export function getQualityLabel(score: number): QualityLabel {
  if (score >= QUALITY.THRESHOLDS.EXCELLENT) return 'Excellent'
  if (score >= QUALITY.THRESHOLDS.GOOD) return 'Good'
  if (score >= QUALITY.THRESHOLDS.FAIR) return 'Fair'
  return 'Low'
}

export function getQualityTone(
  label: QualityLabel | 'N/A'
): 'success' | 'warning' | 'destructive' | 'muted' {
  if (label === 'N/A') return 'muted'
  if (label === 'Excellent' || label === 'Good') return 'success'
  if (label === 'Fair') return 'warning'
  return 'destructive'
}
