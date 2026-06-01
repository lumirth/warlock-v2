/**
 * Scoring Constants & Weights
 * Single Source of Truth for "Contextual Course Scores"
 */

export const SCORING = {
  // Weights for Composite Quality Score (0-100)
  QUALITY: {
    RMP_WEIGHT: 0.7, // 70% from RateMyProfessor Rating
    GPA_WEIGHT: 0.3, // 30% from GPA (Easy A = Better Quality)
  },

  // Weights for Composite Difficulty Score (0-100)
  DIFFICULTY: {
    GPA_WEIGHT: 0.5, // 50% from GPA (Low GPA = Hard)
    RMP_WEIGHT: 0.5, // 50% from RMP Difficulty (High RMP Diff = Hard)
  },

  // Bayesian Smoothing for RMP
  // We add these "dummy" ratings to pull small samples toward the mean
  BAYESIAN: {
    C: 5, // Confidence factor (equivalent to 5 phantom ratings)
    GLOBAL_RMP_RATING: 3.5, // The average rating we pull towards
    GLOBAL_RMP_DIFFICULTY: 3.0, // The average difficulty we pull towards
  },

  // Normalization Ranges
  RANGES: {
    GPA_MAX: 4.0,
    GPA_MIN: 2.0, // We cap "bad" GPA at 2.0 for scaling purposes
    GPA_DIFFICULTY_EASY: 3.5,
    GPA_DIFFICULTY_HARD: 2.7,
    RMP_MAX: 5.0,
    RMP_MIN: 1.0,
  }
};

/**
 * Normalizes a GPA (2.0-4.0) to a 0-100 scale.
 * 4.0 -> 100
 * 2.0 -> 0
 */
export function normalizeGpa(gpa: number): number {
  const clamped = Math.min(Math.max(gpa, SCORING.RANGES.GPA_MIN), SCORING.RANGES.GPA_MAX);
  return ((clamped - SCORING.RANGES.GPA_MIN) / (SCORING.RANGES.GPA_MAX - SCORING.RANGES.GPA_MIN)) * 100;
}

/**
 * Normalizes an RMP Rating (1.0-5.0) to a 0-100 scale.
 * 5.0 -> 100
 * 1.0 -> 0
 */
export function normalizeRmp(rating: number): number {
  const clamped = Math.min(Math.max(rating, SCORING.RANGES.RMP_MIN), SCORING.RANGES.RMP_MAX);
  return ((clamped - SCORING.RANGES.RMP_MIN) / (SCORING.RANGES.RMP_MAX - SCORING.RANGES.RMP_MIN)) * 100;
}

/**
 * Normalizes course GPA into a difficulty score.
 * 3.5+ -> 0 difficulty, 2.7 or below -> 100 difficulty.
 */
export function normalizeGpaDifficulty(gpa: number): number {
  const clamped = Math.min(
    Math.max(gpa, SCORING.RANGES.GPA_DIFFICULTY_HARD),
    SCORING.RANGES.GPA_DIFFICULTY_EASY
  );
  return (
    (SCORING.RANGES.GPA_DIFFICULTY_EASY - clamped) /
    (SCORING.RANGES.GPA_DIFFICULTY_EASY - SCORING.RANGES.GPA_DIFFICULTY_HARD)
  ) * 100;
}

/**
 * Bayesian Average for RMP Ratings
 */
export function bayesianAverage(rating: number, count: number, globalAvg: number): number {
  if (count === 0) return globalAvg;
  // (R * v + C * m) / (v + C)
  return (rating * count + SCORING.BAYESIAN.C * globalAvg) / (count + SCORING.BAYESIAN.C);
}
