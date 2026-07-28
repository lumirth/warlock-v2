export const COURSE_SCORE_POLICY = {
  // A quality signal is only published when both independently sampled sources
  // meet their evidence floors. Missing inputs are never reweighted to 100%.
  QUALITY: {
    RMP_WEIGHT: 0.6,
    GPA_WEIGHT: 0.4,
    MIN_GPA_RECORDS: 30,
    MIN_RMP_RATINGS: 5,
  },

  // Difficulty is a student-rating proxy, not an estimate derived from grades.
  DIFFICULTY: {
    MIN_RMP_RATINGS: 5,
  },

  RANGES: {
    GPA_MAX: 4.0,
    GPA_MIN: 2.0,
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
