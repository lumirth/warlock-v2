import {
  SEARCH_BROWSEABLE_RESULT_LIMIT,
} from "@uiuc-course-search/query-types";

export const MAX_BROWSEABLE_SEARCH_RESULTS = SEARCH_BROWSEABLE_RESULT_LIMIT;
export const MAX_SEMANTIC_LANE_RESULTS = 100;
export const MAX_RETRIEVAL_LANE_RESULTS = 400;
export const MAX_HYDRATED_SEARCH_CANDIDATES = 400;

/**
 * Search ranks one stable, bounded browse window. Exact match counting is a
 * separate retrieval concern, so this budget never masquerades as a total.
 */
export type SearchCandidateBudget = {
  browseableResultLimit: number;
  semanticLaneResultLimit: number;
};

export function buildSearchCandidateBudget(
  browseableResultLimit = MAX_BROWSEABLE_SEARCH_RESULTS,
): SearchCandidateBudget {
  return {
    browseableResultLimit,
    semanticLaneResultLimit: Math.min(
      browseableResultLimit,
      MAX_SEMANTIC_LANE_RESULTS,
    ),
  };
}
