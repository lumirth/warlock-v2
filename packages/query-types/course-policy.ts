export type NormalizedQualityScore = number & {
  readonly __scoreKind: "NormalizedQualityScore";
};

export type NormalizedWorkloadScore = number & {
  readonly __scoreKind: "NormalizedWorkloadScore";
};

export function toNormalizedQualityScore(
  score: number | null | undefined,
): NormalizedQualityScore | null {
  return toNormalizedScore(score) as NormalizedQualityScore | null;
}

export function toNormalizedWorkloadScore(
  score: number | null | undefined,
): NormalizedWorkloadScore | null {
  return toNormalizedScore(score) as NormalizedWorkloadScore | null;
}

function toNormalizedScore(score: number | null | undefined): number | null {
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  return Math.min(100, Math.max(0, score));
}

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

export const SCORING = {
  ...COURSE_SCORE_POLICY,
  DIFFICULTY: COURSE_SCORE_POLICY.WORKLOAD,
} as const;

export const QUALITY_TIER_THRESHOLDS = {
  EXCELLENT: 85,
  GOOD: 70,
  FAIR: 50,
} as const;

export type QualityTierLabel = "Excellent" | "Good" | "Fair" | "Low";

export function getQualityTierLabel(
  score: number | null | undefined,
): QualityTierLabel | null {
  const normalized = toNormalizedQualityScore(score);
  if (normalized === null) return null;
  if (normalized >= QUALITY_TIER_THRESHOLDS.EXCELLENT) return "Excellent";
  if (normalized >= QUALITY_TIER_THRESHOLDS.GOOD) return "Good";
  if (normalized >= QUALITY_TIER_THRESHOLDS.FAIR) return "Fair";
  return "Low";
}

export function getQualityTierRank(
  score: number | null | undefined,
): number | null {
  const label = getQualityTierLabel(score);
  if (label === "Excellent") return 4;
  if (label === "Good") return 3;
  if (label === "Fair") return 2;
  if (label === "Low") return 1;
  return null;
}

export const WORKLOAD_TIER_THRESHOLDS = {
  HARD: 75,
  MODERATE: 45,
} as const;

export const WORKLOAD_FILTER_THRESHOLDS = {
  easy: {
    maxScoreInclusive: WORKLOAD_TIER_THRESHOLDS.MODERATE,
    fallbackMinGpa: 3.5,
  },
  hard: {
    minScoreExclusive: WORKLOAD_TIER_THRESHOLDS.HARD,
    fallbackMaxGpa: 3.0,
  },
} as const;

export type WorkloadTierLabel = "Easy" | "Moderate" | "Hard";

export function getWorkloadTierLabel(
  score: number | null | undefined,
): WorkloadTierLabel | null {
  const normalized = toNormalizedWorkloadScore(score);
  if (normalized === null) return null;
  if (normalized > WORKLOAD_TIER_THRESHOLDS.HARD) return "Hard";
  if (normalized > WORKLOAD_TIER_THRESHOLDS.MODERATE) return "Moderate";
  return "Easy";
}

export function getWorkloadTierRank(
  score: number | null | undefined,
): number | null {
  const label = getWorkloadTierLabel(score);
  if (label === "Easy") return 1;
  if (label === "Moderate") return 2;
  if (label === "Hard") return 3;
  return null;
}

export const COURSE_USEFULNESS_POLICY = {
  EASY_INTENT: {
    MIN_QUALITY_TIER_RANK: 3,
    PREFERRED_WORKLOAD_TIER: "Easy",
    MIN_AVG_GPA: 3.5,
  },
  FUSION: {
    QUALITY_TIER_WEIGHT: 0.08,
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

export const normalizeGpaDifficulty = normalizeGpaWorkload;

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

export const REQUIREMENT_FILTER_MODES = ["single", "any", "all"] as const;

export type RequirementFilterMode = (typeof REQUIREMENT_FILTER_MODES)[number];

export type RequirementFilter = {
  mode: RequirementFilterMode;
  codes: string[];
};

export function requirementFilter(
  mode: RequirementFilterMode,
  codes: readonly string[],
): RequirementFilter | undefined {
  const normalizedCodes = normalizeRequirementCodes(codes);
  if (normalizedCodes.length === 0) return undefined;
  return { mode, codes: normalizedCodes };
}

export function singleRequirementFilter(
  code: string | null | undefined,
): RequirementFilter | undefined {
  return code ? requirementFilter("single", [code]) : undefined;
}

export function effectiveRequirementFilter(
  filters: { requirement?: RequirementFilter },
): RequirementFilter | undefined {
  return filters.requirement;
}

export function requirementFilterCodes(
  filters: { requirement?: RequirementFilter },
): string[] {
  return effectiveRequirementFilter(filters)?.codes ?? [];
}

export function hasRequirementFilter(
  filters: { requirement?: RequirementFilter },
): boolean {
  return requirementFilterCodes(filters).length > 0;
}

export function normalizeRequirementCodes(codes: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const code of codes) {
    const value = code.trim().toUpperCase();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}
