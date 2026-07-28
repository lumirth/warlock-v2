import {
  type NormalizedSearchRequestDto,
  type SearchRequestDto,
  type SearchRequestFiltersDto,
} from "@uiuc-course-search/query-types";
import type {
  Hint,
  SearchFilters,
  SearchPlan,
} from "./search-planner-types.js";
import { formatDisplayHintValue } from "./search-hint-labels.js";
import { meaningfulResidualQuery } from "./search-request-text.js";

export function buildInterpretedSearchRequest(
  hints: Hint[],
  plan: SearchPlan,
  residual: string,
  request: NormalizedSearchRequestDto,
): SearchRequestDto {
  const filters = publicFiltersFromPlan(
    hints,
    plan.filters,
    residual,
    request.filters,
  );
  return {
    query: meaningfulResidualQuery(residual),
    filters: Object.keys(filters).length > 0 ? filters : undefined,
    sort: request.sort,
    scope: request.scope,
  };
}

function publicFiltersFromPlan(
  hints: Hint[],
  filters: SearchFilters,
  residual: string,
  requestFilters: SearchRequestFiltersDto = {},
): SearchRequestFiltersDto {
  const instructorHint = hints.find((hint) => hint.type === "instructor");

  return compactPublicFilters({
    subject: filters.subject,
    number: filters.number,
    instructor: requestFilters.instructor
      ?? (instructorHint ? formatDisplayHintValue(instructorHint, residual) : undefined),
    term: filters.term,
    year: filters.year,
    requirement: filters.requirement,
    credits: filters.credits,
    days: filters.days,
    time: filters.time,
    online: filters.online,
    status: filters.status,
    instructorDifficulty: filters.instructorDifficulty,
    level: filters.level,
    partOfTerm: filters.partOfTerm,
  });
}

function compactPublicFilters(filters: SearchRequestFiltersDto): SearchRequestFiltersDto {
  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== undefined),
  ) as SearchRequestFiltersDto;
}
