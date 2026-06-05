import { describe, expect, it } from 'vitest';
import { getWorkloadTierLabel } from '@uiuc-course-search/query-types';
import { RANKING_POLICY, WORKLOAD_FILTER_THRESHOLDS } from '../ranking/ranking-policy.js';
import { COURSE_SCORE_POLICY, normalizeGpaWorkload } from '../course-score-policy.js';

describe('server ranking policy', () => {
  it('owns retrieval lane weights and usefulness boosts outside the public DTO package', () => {
    expect(RANKING_POLICY.retrievalFusion.laneWeights.exact).toBeGreaterThan(
      RANKING_POLICY.retrievalFusion.laneWeights.topic_semantic,
    );
    expect(RANKING_POLICY.components.qualityTierWeight).toBe(0.08);
    expect(RANKING_POLICY.components.easyIntent.preferredWorkloadTier).toBe('Easy');
  });

  it('keeps workload filter cutoffs aligned with displayed workload tiers', () => {
    expect(getWorkloadTierLabel(WORKLOAD_FILTER_THRESHOLDS.easy.maxScoreInclusive)).toBe('Easy');
    expect(getWorkloadTierLabel(WORKLOAD_FILTER_THRESHOLDS.easy.maxScoreInclusive + 1)).toBe('Moderate');
    expect(getWorkloadTierLabel(WORKLOAD_FILTER_THRESHOLDS.hard.minScoreExclusive)).toBe('Moderate');
    expect(getWorkloadTierLabel(WORKLOAD_FILTER_THRESHOLDS.hard.minScoreExclusive + 1)).toBe('Hard');
  });

  it('owns raw score construction policy on the server side', () => {
    expect(COURSE_SCORE_POLICY.WORKLOAD.GPA_WEIGHT).toBe(0.5);
    expect(normalizeGpaWorkload(3.5)).toBe(0);
  });
});
