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
