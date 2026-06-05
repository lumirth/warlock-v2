import {
  effectiveRequirementFilter,
  isSearchLevelFilter,
  isSearchStatusFilter,
  isSearchTermFilter,
  isSearchTimeFilter,
  type NormalizedSearchRequestDto,
  type SearchRequestDto,
  type SearchRequestFiltersDto,
} from "@uiuc-course-search/query-types";
import { isGenericAnyGenedFilter } from "./gened-codes.js";
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
  const filters = publicFiltersFromPlan(hints, plan.filters, residual);
  return {
    query: meaningfulResidualQuery(residual),
    filters: Object.keys(filters).length > 0 ? filters : undefined,
    sort: request.sort,
    scope: request.scope,
  };
}

export function publicFiltersFromPlan(
  hints: Hint[],
  filters: SearchFilters,
  residual: string,
): SearchRequestFiltersDto {
  const instructorHint = hints.find((hint) => hint.type === "instructor");

  return compactPublicFilters({
    subject: filters.subject,
    number: filters.number,
    instructor: instructorHint ? formatDisplayHintValue(instructorHint, residual) : undefined,
    term: publicTerm(filters.term),
    year: filters.year,
    requirement: publicRequirementCode(filters),
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

function publicRequirementCode(filters: SearchFilters): string | undefined {
  const requirement = effectiveRequirementFilter(filters);
  if (!requirement) return undefined;
  if (requirement.mode === "any" && isGenericAnyGenedFilter(requirement.codes)) {
    return undefined;
  }
  return requirement.codes[0];
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
