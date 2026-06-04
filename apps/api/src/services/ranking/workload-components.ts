import {
  COURSE_USEFULNESS_POLICY,
  getQualityTierLabel,
  getQualityTierRank,
  getWorkloadTierLabel,
} from "@uiuc-course-search/query-types";
import type { Course } from "../../db/types.js";
import type { SearchPlan } from "../search-planner-types.js";
import type { RankingScoreComponent, SearchResult } from "../search-types.js";
import { catalogLevel } from "./ranking-text.js";
import { scoreComponent } from "./score-utils.js";

export function workloadPreferenceComponents(
  result: SearchResult,
  plan: SearchPlan,
): RankingScoreComponent[] {
  if (!hasEasyOrAccessibleIntent(plan)) {
    return [];
  }

  const components: RankingScoreComponent[] = [];
  const { course } = result;
  const level = catalogLevel(course.number);
  const qualityTierRank = getQualityTierRank(course.quality_score);
  const qualityLabel = getQualityTierLabel(course.quality_score);
  const workloadTier = getWorkloadTierLabel(course.difficulty_score);

  if (
    qualityTierRank !== null &&
    qualityTierRank >= COURSE_USEFULNESS_POLICY.EASY_INTENT.MIN_QUALITY_TIER_RANK
  ) {
    components.push(scoreComponent(
      "workload_preference",
      0.25,
      `${qualityLabel} quality tier supports an easy or low-risk course choice.`,
      qualityLabel ? [qualityLabel] : undefined,
    ));
  }

  if (workloadTier === COURSE_USEFULNESS_POLICY.EASY_INTENT.PREFERRED_WORKLOAD_TIER) {
    components.push(scoreComponent(
      "workload_preference",
      0.3,
      "Displayed workload tier is Easy.",
      [workloadTier],
    ));
  }

  if (
    typeof course.avg_gpa === "number" &&
    course.avg_gpa >= COURSE_USEFULNESS_POLICY.EASY_INTENT.MIN_AVG_GPA
  ) {
    components.push(scoreComponent(
      "workload_preference",
      0.2,
      "Average GPA evidence supports a lower-risk workload interpretation.",
      [`Avg GPA ${course.avg_gpa.toFixed(2)}`],
    ));
  }

  const levelValue = easyIntentLevelValue(level);
  if (levelValue !== 0) {
    components.push(scoreComponent(
      "level_accessibility",
      levelValue,
      levelValue > 0
        ? `${level} level is more accessible for easy/non-major intent.`
        : `${level} level is a risk for easy/non-major intent.`,
      level !== null ? [`${level} level`] : undefined,
    ));
  }

  if (result.laneMatches?.includes("workload_evidence")) {
    components.push(scoreComponent(
      "workload_evidence",
      0.3,
      "Structured workload evidence reinforces the easy/low-workload preference.",
      result.supportedSubjectiveClaims,
    ));
  }

  return components;
}

export function eligibilityComponent(
  course: Course,
  plan: SearchPlan,
): RankingScoreComponent | null {
  if (!plan.softPreferences?.noListedPrereq) {
    return null;
  }

  const text = `${course.title ?? ""} ${course.description ?? ""}`.toLowerCase();
  if (!/\b(prereq|prerequisite|consent|restricted|permission|credit or concurrent)\b/.test(text)) {
    return scoreComponent(
      "eligibility",
      0.35,
      "No listed prerequisite risk found in exposed course text.",
    );
  }

  return scoreComponent(
    "eligibility",
    -0.35,
    "Prerequisite, consent, or restriction language is visible in course text.",
  );
}

export function nullDataPenaltyComponent(
  result: SearchResult,
  plan: SearchPlan,
): RankingScoreComponent | null {
  const needsEvidence = Boolean(
    plan.rescue?.queryTypes.includes("subjective_vibe")
    || plan.rescue?.queryTypes.includes("avoidance"),
  );
  if (!needsEvidence) return null;

  const hasStructuredSupport = result.laneMatches?.includes("workload_evidence")
    || Boolean(result.supportedSubjectiveClaims?.length)
    || typeof result.course.quality_score === "number"
    || typeof result.course.difficulty_score === "number"
    || typeof result.course.avg_gpa === "number";

  return hasStructuredSupport
    ? null
    : scoreComponent(
      "null_data_penalty",
      -0.35,
      "Subjective preference has no visible workload, quality, or GPA evidence for this course.",
    );
}

function hasEasyOrAccessibleIntent(plan: SearchPlan): boolean {
  const soft = plan.softPreferences ?? {};
  return Boolean(
    soft.lowWorkload
    || soft.lowWriting
    || soft.lowReading
    || soft.lowExams
    || soft.nonMajorFriendly
    || plan.filters.difficulty === "easy",
  );
}

function easyIntentLevelValue(level: number | null): number {
  if (level === 100) return 0.55;
  if (level === 200) return 0.35;
  if (level === 300) return 0.05;
  if (level === 400) return -0.35;
  if (level !== null && level >= 500) return -1.25;
  return 0;
}
