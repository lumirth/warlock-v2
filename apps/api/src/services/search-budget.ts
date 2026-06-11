import {
  SEARCH_PAGINATION_MAX_LIMIT,
  SEARCH_PAGINATION_MAX_OFFSET,
} from "@uiuc-course-search/query-types";

export const MAX_BROWSEABLE_SEARCH_RESULTS =
  SEARCH_PAGINATION_MAX_OFFSET + SEARCH_PAGINATION_MAX_LIMIT;
export const MAX_SEMANTIC_LANE_RESULTS = 100;

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
