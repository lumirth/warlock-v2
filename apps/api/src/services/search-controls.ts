import {
  DEFAULT_SEARCH_SCOPE,
  DEFAULT_SEARCH_SORT,
  SEARCH_SORT_FIELDS,
  SEARCH_SORT_DEFAULT_DIRECTIONS,
  getQualityTierRank,
  getWorkloadTierRank,
  type SearchScope,
  type SearchSort,
} from "@uiuc-course-search/query-types";
import type { SearchPlan } from "@uiuc-course-search/query-types/search-planner";
import type { SearchResult } from "./search-types.js";

export interface SearchControls {
  sort?: Partial<SearchSort>;
  scope?: SearchScope;
}

export type AppliedSearchControls = {
  sort: SearchSort;
  scope: SearchScope;
};

export const DEFAULT_SEARCH_CONTROLS: AppliedSearchControls = {
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

export function applySearchControls(
  results: SearchResult[],
  controls: SearchControls = DEFAULT_SEARCH_CONTROLS,
  context: { hasExplicitTermFilter?: boolean } = {},
): SearchResult[] {
  const applied = normalizeSearchControls(controls);
  const scopedResults =
    applied.scope === "active" && !context.hasExplicitTermFilter
      ? results.filter((result) => result.historical !== true)
      : [...results];

  if (applied.sort.field === "relevance") {
    return scopedResults;
  }

  return scopedResults
    .map((result, relevanceIndex) => ({
      result,
      relevanceIndex,
      value: sortValueForResult(result, applied.sort.field),
    }))
    .sort((left, right) => {
      if (left.value === null && right.value === null) {
        return left.relevanceIndex - right.relevanceIndex;
      }
      if (left.value === null) return 1;
      if (right.value === null) return -1;

      if (left.value !== right.value) {
        return applied.sort.direction === "asc"
          ? left.value - right.value
          : right.value - left.value;
      }

      return left.relevanceIndex - right.relevanceIndex;
    })
    .map((item) => item.result);
}

export function controlsWithPlanInferredSort(
  controls: AppliedSearchControls,
  plan: SearchPlan,
): AppliedSearchControls {
  if (controls.sort.field !== "relevance") {
    return controls;
  }

  const inferred = plan.softPreferences?.inferredSort;
  if (!isSearchSort(inferred)) {
    return controls;
  }

  return {
    ...controls,
    sort: inferred,
  };
}

function sortValueForResult(
  result: SearchResult,
  field: SearchSort["field"],
): number | null {
  const course = result.course;

  switch (field) {
    case "gpa":
      return typeof course.avg_gpa === "number" ? course.avg_gpa : null;
    case "quality":
      return getQualityTierRank(course.quality_score);
    case "workload":
      return getWorkloadTierRank(course.difficulty_score);
    case "instructor_rating":
      return typeof course.primary_instructor_rmp === "number"
        ? course.primary_instructor_rmp
        : null;
    case "level":
      return parseCourseNumberForSort(course.number);
    case "credits":
      return typeof course.credit_hours === "number"
        ? course.credit_hours
        : null;
    case "relevance":
      return null;
  }
}

function parseCourseNumberForSort(value: string | null | undefined): number | null {
  const match = String(value ?? "").match(/\d+/);
  if (!match) return null;

  const parsed = Number.parseInt(match[0], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function isSearchSort(value: unknown): value is SearchSort {
  if (!value || typeof value !== "object") return false;
  const candidate = value as SearchSort;
  return (
    SEARCH_SORT_FIELDS.includes(candidate.field) &&
    (candidate.direction === "asc" || candidate.direction === "desc")
  );
}
