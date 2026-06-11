import { describe, expect, it } from 'vitest'
import {
  getQualityLabel,
  getQualityTone,
  getWorkloadLabel,
  isFiniteMetric,
} from './grading'

describe('quality labels', () => {
  it('uses Low for below-fair quality scores instead of evidence-coverage language', () => {
    expect(getQualityLabel(49)).toBe('Low')
    expect(getQualityTone('Low')).toBe('destructive')
  })

  it('does not turn invalid metrics into positive labels', () => {
    expect(getQualityLabel(Number.NaN)).toBe('N/A')
    expect(getWorkloadLabel(Number.NaN)).toBe('N/A')
    expect(isFiniteMetric(Number.NaN)).toBe(false)
    expect(isFiniteMetric(58)).toBe(true)
  })
})
