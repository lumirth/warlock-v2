import {
  isSearchLevelFilter,
  isSearchStatusFilter,
  isSearchTermFilter,
  isSearchTimeFilter,
  type NormalizedSearchRequestDto,
  type RequirementFilter,
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
    term: publicTerm(filters.term),
    year: filters.year,
    requirement: publicRequirementFilter(filters),
    credits: filters.credits,
    days: filters.days,
    time: publicTime(filters.time),
    online: filters.online,
    status: publicStatus(filters.status),
    workload: filters.workload,
    level: publicLevel(filters.level),
    partOfTerm: filters.partOfTerm,
  });
}

function compactPublicFilters(filters: SearchRequestFiltersDto): SearchRequestFiltersDto {
  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== undefined),
  ) as SearchRequestFiltersDto;
}

function publicRequirementFilter(filters: SearchFilters): RequirementFilter | undefined {
  const requirement = filters.requirement;
  if (!requirement) return undefined;
  return requirement;
}

function publicTerm(value: string | undefined): SearchRequestFiltersDto["term"] {
  return isSearchTermFilter(value) ? value : undefined;
}

function publicTime(value: string | undefined): SearchRequestFiltersDto["time"] {
  return isSearchTimeFilter(value) ? value : undefined;
}

function publicStatus(value: string | undefined): SearchRequestFiltersDto["status"] {
  return isSearchStatusFilter(value) ? value : undefined;
}

function publicLevel(value: number | undefined): SearchRequestFiltersDto["level"] {
  return isSearchLevelFilter(value) ? value : undefined;
}
