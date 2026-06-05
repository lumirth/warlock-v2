import {
  getQualityTierLabel,
  getQualityTierRank,
} from "@uiuc-course-search/query-types";
import type { Course } from "../../db/types.js";
import type { SearchPlan } from "../search-planner-types.js";
import type { RankingScoreComponent, SearchResult } from "../search-types.js";
import { introductoryGatewayComponents } from "./gateway-components.js";
import { negativePreferenceComponent } from "./negative-preferences.js";
import { titleMatchScore } from "./ranking-text.js";
import { requirementComponent } from "./requirement-components.js";
import { scoreComponent } from "./score-utils.js";
import {
  eligibilityComponent,
  nullDataPenaltyComponent,
  workloadPreferenceComponents,
} from "./workload-components.js";
import { RANKING_POLICY } from "./ranking-policy.js";

export function rankingComponentsForResult(
  result: SearchResult,
  plan: SearchPlan,
  query: string,
): RankingScoreComponent[] {
  return [
    retrievalFusionComponent(result),
    titleMatchComponent(result.course, query),
    exactnessComponent(result),
    qualityTierComponent(result.course),
    requirementComponent(result, plan),
    laneMatchComponent(
      result,
      "structured_section",
      "availability_term",
      RANKING_POLICY.components.laneMatch.structuredSection,
      "Section constraints matched structured offering data.",
    ),
    laneMatchComponent(
      result,
      "student_language_alias",
      "student_language",
      RANKING_POLICY.components.laneMatch.studentLanguageAlias,
      "Student-language aliases matched this course.",
    ),
    laneMatchComponent(
      result,
      "workload_evidence",
      "workload_evidence",
      RANKING_POLICY.components.laneMatch.workloadEvidence,
      "Workload evidence matched the subjective preference.",
    ),
    ...workloadPreferenceComponents(result, plan),
    eligibilityComponent(result.course, plan),
    negativePreferenceComponent(result.course, plan),
    nullDataPenaltyComponent(result, plan),
    ...introductoryGatewayComponents(result, plan),
  ].filter((component): component is RankingScoreComponent => Boolean(component));
}

function retrievalFusionComponent(result: SearchResult): RankingScoreComponent {
  const lanes = result.laneMatches?.length ? result.laneMatches.join(", ") : "retrieval";
  const laneEvidence = result.laneResults
    ?.map(row => `${row.lane} #${row.rank}: ${row.reason}`)
    .slice(0, 5);
  return scoreComponent(
    "retrieval_fusion",
    result.score,
    `Retrieval lane fusion from ${lanes}.`,
    laneEvidence,
  );
}

function titleMatchComponent(
  course: Course,
  query: string,
): RankingScoreComponent | null {
  const value = titleMatchScore(course.title, query);
  if (value === 0) return null;
  return scoreComponent(
    "title_match",
    value,
    value >= 2.5
      ? `Title exactly matches "${course.title}".`
      : "Title matches the query text.",
    [course.title ?? ""].filter(Boolean),
  );
}

function exactnessComponent(result: SearchResult): RankingScoreComponent | null {
  if (!result.laneMatches?.includes("exact")) {
    return null;
  }

  const evidence = result.laneResults
    ?.filter(row => row.lane === "exact")
    .map(row => row.reason);
  return scoreComponent(
    "exactness",
    RANKING_POLICY.components.exactness,
    "Exact course or CRN lookup dominates broad relevance signals.",
    evidence,
  );
}

function qualityTierComponent(course: Course): RankingScoreComponent | null {
  const tierRank = getQualityTierRank(course.quality_score);
  if (tierRank === null) return null;
  const label = getQualityTierLabel(course.quality_score);
  return scoreComponent(
    "quality_tier",
    tierRank * RANKING_POLICY.components.qualityTierWeight,
    `${label} quality tier contributes a small trust component.`,
    label ? [label] : undefined,
  );
}

function laneMatchComponent(
  result: SearchResult,
  lane: NonNullable<SearchResult["laneMatches"]>[number],
  name: RankingScoreComponent["name"],
  value: number,
  reason: string,
): RankingScoreComponent | null {
  if (!result.laneMatches?.includes(lane)) return null;
  const evidence = result.laneResults
    ?.filter(row => row.lane === lane)
    .map(row => row.reason);
  return scoreComponent(name, value, reason, evidence);
}
