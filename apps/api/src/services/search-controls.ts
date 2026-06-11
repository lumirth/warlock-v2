import {
  DEFAULT_SEARCH_SCOPE,
  DEFAULT_SEARCH_SORT,
  SEARCH_SORT_DEFAULT_DIRECTIONS,
  type SearchScope,
  type SearchSort,
} from "@uiuc-course-search/query-types";
import type { SearchPlan } from "./search-planner-types.js";

interface SearchControls {
  sort?: Partial<SearchSort>;
  scope?: SearchScope;
}

export type AppliedSearchControls = {
  sort: SearchSort;
  scope: SearchScope;
};

const DEFAULT_SEARCH_CONTROLS: AppliedSearchControls = {
  sort: DEFAULT_SEARCH_SORT,
  scope: DEFAULT_SEARCH_SCOPE,
};

export function normalizeSearchControls(
  controls?: SearchControls,
): AppliedSearchControls {
  const field = controls?.sort?.field ?? DEFAULT_SEARCH_CONTROLS.sort.field;
  const direction =
    controls?.sort?.direction ??
    SEARCH_SORT_DEFAULT_DIRECTIONS[field] ??
    DEFAULT_SEARCH_CONTROLS.sort.direction;

  return {
    sort: { field, direction },
    scope: controls?.scope ?? DEFAULT_SEARCH_CONTROLS.scope,
  };
}

export function controlsWithPlanInferredSort(
  controls: AppliedSearchControls,
  plan: SearchPlan,
): AppliedSearchControls {
  if (controls.sort.field !== "relevance") {
    return controls;
  }

  const inferred = plan.softPreferences?.inferredSort;
  if (!inferred) {
    return controls;
  }

  return {
    ...controls,
    sort: inferred,
  };
}
