import {
  deepFreezeSearchContractValue,
  normalizeSearchRequestDto,
  searchRequestHasFilters,
  singleRequirementFilter,
  type NormalizedSearchRequestDto,
  type SearchRequestDto,
  type SearchRequestFiltersDto,
} from "@uiuc-course-search/query-types";
import type { SearchFilters } from "./search-planner-types.js";

export type CanonicalSearchRequest = NormalizedSearchRequestDto;

export function normalizeSearchRequest(
  request: SearchRequestDto,
): CanonicalSearchRequest {
  return normalizeSearchRequestDto(request);
}

export function searchPlanFiltersFromRequestFilters(
  requestFilters?: SearchRequestFiltersDto,
): Partial<SearchFilters> | undefined {
  if (!requestFilters) return undefined;

  const filters: Partial<SearchFilters> = {};
  if (requestFilters.subject !== undefined) filters.subject = requestFilters.subject;
  if (requestFilters.number !== undefined) filters.number = requestFilters.number;
  if (requestFilters.term !== undefined) filters.term = requestFilters.term;
  if (requestFilters.year !== undefined) filters.year = requestFilters.year;
  if (requestFilters.requirement !== undefined) {
    filters.requirement = singleRequirementFilter(requestFilters.requirement);
  }
  if (requestFilters.credits !== undefined) filters.credits = requestFilters.credits;
  if (requestFilters.days !== undefined) filters.days = requestFilters.days;
  if (requestFilters.time !== undefined) filters.time = requestFilters.time;
  if (requestFilters.partOfTerm !== undefined) {
    filters.partOfTerm = requestFilters.partOfTerm;
  }
  if (requestFilters.online !== undefined) filters.online = requestFilters.online;
  if (requestFilters.status !== undefined) filters.status = requestFilters.status;
  if (requestFilters.workload !== undefined) {
    filters.workload = requestFilters.workload;
  }
  if (requestFilters.level !== undefined) filters.level = requestFilters.level;

  return Object.keys(filters).length > 0 ? filters : undefined;
}

export function deepFreeze<T>(value: T): T {
  return deepFreezeSearchContractValue(value);
}

export {
  searchRequestHasFilters,
};
