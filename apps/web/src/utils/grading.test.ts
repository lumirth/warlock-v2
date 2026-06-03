import { describe, expect, it } from 'vitest'
import { getQualityLabel, getQualityTone } from './grading'

describe('quality labels', () => {
  it('uses Low for below-fair quality scores instead of evidence-coverage language', () => {
    expect(getQualityLabel(49)).toBe('Low')
    expect(getQualityTone('Low')).toBe('destructive')
  })
})
