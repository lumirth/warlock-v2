import { canonicalRequirementCodes } from "./requirement-options.js";

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
  const normalized = toNormalizedScore(score);
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

const INSTRUCTOR_DIFFICULTY_TIER_THRESHOLDS = {
  HIGHER: 75,
  MODERATE: 45,
} as const;

export type InstructorDifficultyTierLabel = "Lower" | "Moderate" | "Higher";

export function getInstructorDifficultyTierLabel(
  score: number | null | undefined,
): InstructorDifficultyTierLabel | null {
  const normalized = toNormalizedScore(score);
  if (normalized === null) return null;
  if (normalized > INSTRUCTOR_DIFFICULTY_TIER_THRESHOLDS.HIGHER) return "Higher";
  if (normalized > INSTRUCTOR_DIFFICULTY_TIER_THRESHOLDS.MODERATE) return "Moderate";
  return "Lower";
}

export function getInstructorDifficultyTierRank(
  score: number | null | undefined,
): number | null {
  const label = getInstructorDifficultyTierLabel(score);
  if (label === "Lower") return 1;
  if (label === "Moderate") return 2;
  if (label === "Higher") return 3;
  return null;
}

export const GENED_DISPLAY_NAME = "GenEd";
export const ANY_GENED_DISPLAY_LABEL = "Any GenEd";

export function formatGenEdDisplayLabel(codes: readonly string[] | string): string {
  const normalizedCodes = canonicalRequirementCodes(
    Array.isArray(codes) ? codes : [codes],
  );
  return normalizedCodes.length > 0
    ? `${GENED_DISPLAY_NAME} ${normalizedCodes.join(", ")}`
    : GENED_DISPLAY_NAME;
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

export function requirementFilterCodes(
  filters: { requirement?: RequirementFilter },
): string[] {
  return filters.requirement?.codes ?? [];
}

export function hasRequirementFilter(
  filters: { requirement?: RequirementFilter },
): boolean {
  return requirementFilterCodes(filters).length > 0;
}

export function normalizeRequirementCodes(codes: readonly string[]): string[] {
  return canonicalRequirementCodes(codes);
}
