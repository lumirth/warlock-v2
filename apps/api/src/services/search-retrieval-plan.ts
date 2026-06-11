import type { SearchScope } from "@uiuc-course-search/query-types";
import type { SearchFilters, SearchPlan } from "./search-planner-types.js";
import type { SearchCandidateBudget } from "./search-budget.js";
import type { AppliedSearchControls } from "./search-controls.js";
import type { RetrievalLane } from "./search-types.js";
import { sanitizeFtsQuery, titleLaneQuery } from "./search-text.js";

export type RetrievalLaneExecution = {
  lane: RetrievalLane;
  limit: number;
};

type RetrievalPlanInputs = {
  filters: SearchFilters;
  keywordQuery: string;
  cleanKeywordQuery: string;
  titleQuery: string;
  semanticQuery: string;
  scope: SearchScope;
  semanticTermIds: string[];
};

export type RetrievalPlan = {
  controls: AppliedSearchControls;
  budget: SearchCandidateBudget;
  lanes: RetrievalLaneExecution[];
  inputs: RetrievalPlanInputs;
};

export function buildRetrievalPlan(
  plan: SearchPlan,
  controls: AppliedSearchControls,
  budget: SearchCandidateBudget,
  currentTermIds: string[] = [],
): RetrievalPlan {
  const hasKeywordQuery = plan.keywordQuery.trim().length > 0;
  const hasSemanticQuery = plan.semanticQuery.trim().length > 0;
  const cleanKeywordQuery = hasKeywordQuery ? sanitizeFtsQuery(plan.keywordQuery) : "";
  const isNavigational = Boolean(
    (plan.filters.subject && plan.filters.number) ||
      plan.filters.crn,
  );
  const lanes: RetrievalLaneExecution[] = [];
  addLane(lanes, "exact", budget.browseableResultLimit, isNavigational);
  addLane(
    lanes,
    "official_text",
    budget.browseableResultLimit,
    hasKeywordQuery && !isNavigational,
  );
  addLane(
    lanes,
    "structured_course",
    budget.browseableResultLimit,
    !hasKeywordQuery && !isNavigational,
  );
  addLane(lanes, "section_text", budget.browseableResultLimit, hasKeywordQuery);
  addLane(
    lanes,
    "topic_semantic",
    budget.semanticLaneResultLimit,
    hasSemanticQuery && !isNavigational,
  );
  return {
    controls,
    budget,
    lanes,
    inputs: {
      filters: plan.filters,
      keywordQuery: plan.keywordQuery,
      cleanKeywordQuery,
      titleQuery: hasKeywordQuery ? titleLaneQuery(cleanKeywordQuery) : "",
      semanticQuery: plan.semanticQuery,
      scope:
        controls.scope === "active" && !plan.filters.term && !plan.filters.year
          ? "active"
          : "all",
      semanticTermIds: semanticTermIds(plan.filters, controls.scope, currentTermIds),
    },
  };
}

function semanticTermIds(
  filters: SearchFilters,
  scope: SearchScope,
  currentTermIds: string[],
): string[] {
  if (filters.year && filters.term) {
    return [`${filters.year}-${filters.term}`];
  }
  return scope === "active" ? currentTermIds : [];
}

function addLane(
  lanes: RetrievalLaneExecution[],
  laneName: RetrievalLane,
  limit: number,
  enabled = true,
): void {
  if (!enabled) return;
  lanes.push({
    lane: laneName,
    limit,
  });
}
