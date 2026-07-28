import type { Course } from "../../db/types.js";
import type { SearchPlan } from "../search-planner-types.js";
import type { RankingScoreComponent, SearchResult } from "../search-types.js";
import { catalogLevel } from "./ranking-text.js";
import { RANKING_POLICY } from "./ranking-policy.js";
import { scoreComponent } from "./score-utils.js";

export function accessibilityPreferenceComponents(
  result: SearchResult,
  plan: SearchPlan,
): RankingScoreComponent[] {
  if (!hasAccessibilityIntent(plan)) {
    return [];
  }

  const components: RankingScoreComponent[] = [];
  const { course } = result;
  const level = catalogLevel(course.number);

  const levelValue = easyIntentLevelValue(level);
  if (levelValue !== 0) {
    components.push(scoreComponent(
      "level_accessibility",
      levelValue,
      levelValue > 0
        ? `${level} level is more accessible for non-major intent.`
        : `${level} level is a risk for non-major intent.`,
      level !== null ? [`${level} level`] : undefined,
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
      RANKING_POLICY.components.eligibility.noListedPrereq,
      "No listed prerequisite risk found in exposed course text.",
    );
  }

  return scoreComponent(
    "eligibility",
    RANKING_POLICY.components.eligibility.prerequisiteRisk,
    "Prerequisite, consent, or restriction language is visible in course text.",
  );
}

export function nullDataPenaltyComponent(
  result: SearchResult,
  plan: SearchPlan,
): RankingScoreComponent | null {
  const needsEvidence = Boolean(
    plan.intent?.queryTypes.includes("subjective_vibe")
    || plan.intent?.queryTypes.includes("avoidance"),
  );
  if (!needsEvidence) return null;

  const hasStructuredSupport = typeof result.course.quality_score === "number"
    || typeof result.course.avg_gpa === "number";

  return hasStructuredSupport
    ? null
    : scoreComponent(
      "null_data_penalty",
      RANKING_POLICY.components.nullSubjectiveEvidencePenalty,
      "Subjective preference has no visible quality or GPA evidence for this course.",
    );
}

function hasAccessibilityIntent(plan: SearchPlan): boolean {
  const soft = plan.softPreferences ?? {};
  return Boolean(soft.nonMajorFriendly);
}

function easyIntentLevelValue(level: number | null): number {
  const levelPolicy = RANKING_POLICY.components.accessibilityIntent.level;
  if (level === 100) return levelPolicy.level100;
  if (level === 200) return levelPolicy.level200;
  if (level === 300) return levelPolicy.level300;
  if (level === 400) return levelPolicy.level400;
  if (level !== null && level >= 500) return levelPolicy.level500Plus;
  return 0;
}
