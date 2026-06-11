import {
  hasRequirementFilter,
  requirementFilterCodes,
} from "@uiuc-course-search/query-types";
import type { SearchFilters, SearchPlan } from "../search-planner-types.js";
import {
  courseRequirementDtoCodes,
  matchingRequirementCodes,
} from "../search-requirements.js";
import type { RankingScoreComponent, SearchResult } from "../search-types.js";
import { RANKING_POLICY } from "./ranking-policy.js";
import { scoreComponent } from "./score-utils.js";

export function requirementComponent(
  result: SearchResult,
  plan: SearchPlan,
): RankingScoreComponent | null {
  const courseCodes = courseRequirementDtoCodes(result.requirements);
  const matchedCodes = matchingRequestedRequirementCodes(courseCodes, plan.filters);
  if (matchedCodes.length > 0) {
    const policy = RANKING_POLICY.components.requirementIntent.exactMatch;
    return scoreComponent(
      "requirement_match",
      policy.value,
      policy.reason,
      matchedCodes,
    );
  }

  if (!hasRequirementIntent(plan)) {
    return null;
  }

  if (courseCodes.length > 0) {
    const policy = RANKING_POLICY.components.requirementIntent.relatedCredit;
    return scoreComponent(
      "requirement_match",
      policy.value,
      policy.reason,
      courseCodes,
    );
  }

  const policy = RANKING_POLICY.components.requirementIntent.missingMapping;
  return scoreComponent(
    "requirement_match",
    policy.value,
    policy.reason,
  );
}

function hasRequirementIntent(plan: SearchPlan): boolean {
  return Boolean(
    hasRequirementFilter(plan.filters)
    || plan.intent?.queryTypes.includes("requirement")
    || plan.intent?.queryTypes.includes("degree_progress"),
  );
}

function matchingRequestedRequirementCodes(
  courseCodes: readonly string[],
  filters: SearchFilters,
): string[] {
  const requested = requirementFilterCodes(filters);

  if (requested.length === 0) {
    return [];
  }

  return matchingRequirementCodes(courseCodes, requested);
}
