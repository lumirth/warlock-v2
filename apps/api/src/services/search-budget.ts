import type { SearchPlan } from "@uiuc-course-search/query-types/search-planner";
import type { AppliedSearchControls } from "./search-controls.js";

export const DEFAULT_MAX_SEARCH_RESULT_WINDOW = 1200;
export const MIN_INTRODUCTORY_GATEWAY_RESULTS = 40;
export const MIN_ATTRIBUTE_SORT_RESULTS = 200;
export const MIN_LANE_CANDIDATES = 50;
export const TERM_RANKING_CANDIDATE_MULTIPLIER = 2;

export type SearchPageWindow = {
  limit: number;
  offset: number;
};

export type SearchCandidateBudgetReason =
  | "relevance_page_window"
  | "attribute_sort_full_window"
  | "introductory_gateway_minimum";

export type SearchCandidateBudget = {
  pageLimit: number;
  pageOffset: number;
  requestedWindow: number;
  resultWindowLimit: number;
  executionResultLimit: number;
  termCandidateLimit: number;
  laneCandidateLimit: number;
  maxResultWindow: number;
  reasons: SearchCandidateBudgetReason[];
};

export function buildSearchCandidateBudget(
  plan: SearchPlan,
  page: SearchPageWindow,
  controls: AppliedSearchControls,
  maxResultWindow = DEFAULT_MAX_SEARCH_RESULT_WINDOW,
): SearchCandidateBudget {
  const requestedWindow = page.offset + page.limit + 1;
  const relevanceWindow = Math.max(requestedWindow, (page.offset + page.limit) * 2);
  const isAttributeSort = controls.sort.field !== "relevance";
  const reasons: SearchCandidateBudgetReason[] = [];

  let resultWindowLimit = isAttributeSort
    ? maxResultWindow
    : Math.min(maxResultWindow, relevanceWindow);
  reasons.push(
    isAttributeSort ? "attribute_sort_full_window" : "relevance_page_window",
  );

  if (hasIntroductoryGatewayIntent(plan)) {
    resultWindowLimit = Math.max(
      resultWindowLimit,
      MIN_INTRODUCTORY_GATEWAY_RESULTS,
    );
    reasons.push("introductory_gateway_minimum");
  }

  if (isAttributeSort) {
    resultWindowLimit = Math.max(resultWindowLimit, MIN_ATTRIBUTE_SORT_RESULTS);
  }

  const executionResultLimit = Math.min(resultWindowLimit, maxResultWindow);
  const termCandidateLimit = Math.min(
    maxResultWindow * TERM_RANKING_CANDIDATE_MULTIPLIER,
    executionResultLimit * TERM_RANKING_CANDIDATE_MULTIPLIER,
  );
  const laneCandidateLimit = Math.max(
    MIN_LANE_CANDIDATES,
    termCandidateLimit,
  );

  return {
    pageLimit: page.limit,
    pageOffset: page.offset,
    requestedWindow,
    resultWindowLimit,
    executionResultLimit,
    termCandidateLimit,
    laneCandidateLimit,
    maxResultWindow,
    reasons,
  };
}

function hasIntroductoryGatewayIntent(plan: SearchPlan): boolean {
  return Boolean(
    plan.intents?.includes("introductory_gateway") ||
      plan.softPreferences?.introductoryIntent === "gateway",
  );
}
