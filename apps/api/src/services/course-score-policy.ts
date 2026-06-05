export const COURSE_SCORE_POLICY = {
  // Weights for Composite Quality Score (0-100).
  QUALITY: {
    RMP_WEIGHT: 0.7,
    GPA_WEIGHT: 0.3,
  },

  // Weights for Composite Workload Score (0-100).
  WORKLOAD: {
    GPA_WEIGHT: 0.5,
    RMP_WEIGHT: 0.5,
  },

  BAYESIAN: {
    C: 5,
    GLOBAL_RMP_RATING: 3.5,
    GLOBAL_RMP_DIFFICULTY: 3.0,
  },

  RANGES: {
    GPA_MAX: 4.0,
    GPA_MIN: 2.0,
    GPA_WORKLOAD_EASY: 3.5,
    GPA_WORKLOAD_HARD: 2.7,
    RMP_MAX: 5.0,
    RMP_MIN: 1.0,
  },
} as const;

export function normalizeGpa(gpa: number): number {
  const clamped = Math.min(
    Math.max(gpa, COURSE_SCORE_POLICY.RANGES.GPA_MIN),
    COURSE_SCORE_POLICY.RANGES.GPA_MAX,
  );
  return (
    ((clamped - COURSE_SCORE_POLICY.RANGES.GPA_MIN) /
      (COURSE_SCORE_POLICY.RANGES.GPA_MAX - COURSE_SCORE_POLICY.RANGES.GPA_MIN)) *
    100
  );
}

export function normalizeRmp(rating: number): number {
  const clamped = Math.min(
    Math.max(rating, COURSE_SCORE_POLICY.RANGES.RMP_MIN),
    COURSE_SCORE_POLICY.RANGES.RMP_MAX,
  );
  return (
    ((clamped - COURSE_SCORE_POLICY.RANGES.RMP_MIN) /
      (COURSE_SCORE_POLICY.RANGES.RMP_MAX - COURSE_SCORE_POLICY.RANGES.RMP_MIN)) *
    100
  );
}

export function normalizeGpaWorkload(gpa: number): number {
  const clamped = Math.min(
    Math.max(gpa, COURSE_SCORE_POLICY.RANGES.GPA_WORKLOAD_HARD),
    COURSE_SCORE_POLICY.RANGES.GPA_WORKLOAD_EASY,
  );
  return (
    ((COURSE_SCORE_POLICY.RANGES.GPA_WORKLOAD_EASY - clamped) /
      (COURSE_SCORE_POLICY.RANGES.GPA_WORKLOAD_EASY -
        COURSE_SCORE_POLICY.RANGES.GPA_WORKLOAD_HARD)) *
    100
  );
}

export function bayesianAverage(
  rating: number,
  count: number,
  globalAvg: number,
): number {
  if (count === 0) return globalAvg;
  return (
    (rating * count + COURSE_SCORE_POLICY.BAYESIAN.C * globalAvg) /
    (count + COURSE_SCORE_POLICY.BAYESIAN.C)
  );
}
