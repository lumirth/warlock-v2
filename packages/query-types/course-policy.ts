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

const QUALITY_TIER_THRESHOLDS = {
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

const WORKLOAD_TIER_THRESHOLDS = {
  HARD: 75,
  MODERATE: 45,
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
