import { describe, expect, it } from 'vitest';
import {
  getInstructorDifficultyTierLabel,
} from '@uiuc-course-search/query-types';
import {
  INSTRUCTOR_DIFFICULTY_FILTER_THRESHOLDS,
  RANKING_POLICY,
} from '../ranking/ranking-policy.js';
import { COURSE_SCORE_POLICY } from '../course-score-policy.js';

describe('server ranking policy', () => {
  it('owns retrieval lane weights and usefulness boosts outside the public DTO package', () => {
    expect(RANKING_POLICY.retrievalFusion.laneWeights.exact).toBeGreaterThan(
      RANKING_POLICY.retrievalFusion.laneWeights.topic_semantic,
    );
    expect(RANKING_POLICY.components.qualityTierWeight).toBe(0.08);
    expect(RANKING_POLICY.components.accessibilityIntent.level.level100)
      .toBeGreaterThan(0);
  });

  it('aligns instructor-difficulty filters with displayed tiers', () => {
    expect(getInstructorDifficultyTierLabel(
      INSTRUCTOR_DIFFICULTY_FILTER_THRESHOLDS.lower.maxScoreInclusive,
    )).toBe('Lower');
    expect(getInstructorDifficultyTierLabel(
      INSTRUCTOR_DIFFICULTY_FILTER_THRESHOLDS.lower.maxScoreInclusive + 1,
    )).toBe('Moderate');
    expect(getInstructorDifficultyTierLabel(
      INSTRUCTOR_DIFFICULTY_FILTER_THRESHOLDS.higher.minScoreExclusive,
    )).toBe('Moderate');
    expect(getInstructorDifficultyTierLabel(
      INSTRUCTOR_DIFFICULTY_FILTER_THRESHOLDS.higher.minScoreExclusive + 1,
    )).toBe('Higher');
  });

  it('requires independently sampled evidence and never treats GPA as workload', () => {
    expect(COURSE_SCORE_POLICY.QUALITY.MIN_GPA_RECORDS).toBeGreaterThan(0);
    expect(COURSE_SCORE_POLICY.QUALITY.MIN_RMP_RATINGS).toBeGreaterThan(0);
    expect(COURSE_SCORE_POLICY.DIFFICULTY.MIN_RMP_RATINGS).toBeGreaterThan(0);
    expect(COURSE_SCORE_POLICY).not.toHaveProperty('WORKLOAD.GPA_WEIGHT');
  });
});
