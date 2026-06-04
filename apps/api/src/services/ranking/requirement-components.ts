import {
  hasRequirementFilter,
  requirementFilterCodes,
} from "@uiuc-course-search/query-types";
import type { SearchFilters, SearchPlan } from "../search-planner-types.js";
import {
  matchingRequirementCodes,
  searchResultRequirementCodes,
} from "../search-requirements.js";
import type { RankingScoreComponent, SearchResult } from "../search-types.js";
import { scoreComponent } from "./score-utils.js";

export function requirementComponent(
  result: SearchResult,
  plan: SearchPlan,
): RankingScoreComponent | null {
  const courseCodes = searchResultRequirementCodes(result);
  const matchedCodes = matchingRequestedRequirementCodes(courseCodes, plan.filters);
  if (matchedCodes.length > 0) {
    return scoreComponent(
      "requirement_match",
      0.9,
      "Course satisfies the requested requirement filter.",
      matchedCodes,
    );
  }

  if (!hasRequirementIntent(plan)) {
    return null;
  }

  if (courseCodes.length > 0) {
    return scoreComponent(
      "requirement_match",
      0.25,
      "Course has requirement credit, but not the exact requested bucket.",
      courseCodes,
    );
  }

  return scoreComponent(
    "requirement_match",
    -0.25,
    "Requirement intent was detected, but this course has no visible requirement mapping.",
  );
}

function hasRequirementIntent(plan: SearchPlan): boolean {
  return Boolean(
    hasRequirementFilter(plan.filters)
    || plan.rescue?.queryTypes.includes("requirement")
    || plan.rescue?.queryTypes.includes("degree_progress"),
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
