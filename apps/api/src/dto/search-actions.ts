import {
  canonicalRequirementCodes,
  coerceSearchRequestDto,
  requirementFilter,
  searchRequestHasFilters,
  type NormalizedSearchRequestDto,
  type SearchActionDto,
  type SearchRequestDto,
  type SearchRequestFiltersDto,
} from "@uiuc-course-search/query-types";
import { meaningfulResidualQuery } from "../services/search-request-text.js";

export function searchActionFromRequest(
  request: SearchRequestDto,
): SearchActionDto {
  const normalized = coerceSearchRequestDto(request);
  return {
    kind: "run_search",
    nextRequest: {
      query: normalized.query,
      filters: searchRequestHasFilters(normalized) ? normalized.filters : undefined,
      sort: normalized.sort,
      scope: normalized.scope,
    },
  };
}

export function removeSearchIntentAction(
  request: NormalizedSearchRequestDto,
  filter: Partial<SearchRequestFiltersDto> | undefined,
  textToRemove: string | undefined,
): SearchActionDto {
  const withoutFilter = requestWithoutMatchingFilter(request, filter);
  if (withoutFilter) {
    return searchActionFromRequest(withoutFilter);
  }

  return searchActionFromRequest({
    ...request,
    query: removeTextFromQuery(request.query, textToRemove ?? ""),
  });
}

export function ambiguitySearchAction(
  request: NormalizedSearchRequestDto,
  baseFilters: SearchRequestFiltersDto,
  filter: Partial<SearchRequestFiltersDto>,
  residual: string,
): SearchActionDto {
  return searchActionFromRequest(
    requestWithAppliedAmbiguity(request, baseFilters, filter, residual),
  );
}

function requestWithAppliedAmbiguity(
  request: NormalizedSearchRequestDto,
  baseFilters: SearchRequestFiltersDto,
  filter: Partial<SearchRequestFiltersDto>,
  residual: string,
): SearchRequestDto {
  const nextFilters = { ...baseFilters };
  if (filter.requirement) {
    delete nextFilters.subject;
    delete nextFilters.number;
    nextFilters.requirement = filter.requirement;
  }
  if (filter.subject) {
    delete nextFilters.requirement;
    nextFilters.subject = filter.subject;
  }

  return {
    query: meaningfulResidualQuery(residual),
    filters: nextFilters,
    sort: request.sort,
    scope: request.scope,
  };
}

function requestWithoutMatchingFilter(
  request: NormalizedSearchRequestDto,
  filter: Partial<SearchRequestFiltersDto> | undefined,
): SearchRequestDto | null {
  if (!filter || Object.keys(filter).length === 0) return null;

  const nextFilters = { ...request.filters };
  let changed = false;

  for (const [key, value] of Object.entries(filter) as Array<
    [keyof SearchRequestFiltersDto, SearchRequestFiltersDto[keyof SearchRequestFiltersDto]]
  >) {
    if (value === undefined) continue;
    if (key === "requirement" && isRequirementFilterValue(value)) {
      const nextRequirement = removeRequirementCodes(
        nextFilters.requirement,
        value.codes,
      );
      if (!nextRequirement.changed) continue;
      if (nextRequirement.requirement) {
        nextFilters.requirement = nextRequirement.requirement;
      } else {
        delete nextFilters.requirement;
      }
      changed = true;
      continue;
    }
    if (!searchFilterValuesEqual(nextFilters[key], value)) {
      continue;
    }
    delete nextFilters[key];
    changed = true;
  }

  return changed
    ? {
        query: request.query,
        filters: nextFilters,
        sort: request.sort,
        scope: request.scope,
      }
    : null;
}

function removeRequirementCodes(
  current: SearchRequestFiltersDto["requirement"],
  codesToRemove: readonly string[],
): {
  changed: boolean;
  requirement?: NonNullable<SearchRequestFiltersDto["requirement"]>;
} {
  if (!current) return { changed: false };
  const removeSet = new Set(canonicalRequirementCodes(codesToRemove));
  if (removeSet.size === 0) return { changed: false };

  const nextCodes = current.codes.filter(
    (code) => {
      const canonicalCode = canonicalRequirementCodes([code])[0];
      return canonicalCode ? !removeSet.has(canonicalCode) : true;
    },
  );
  if (nextCodes.length === current.codes.length) return { changed: false };
  if (nextCodes.length === 0) return { changed: true };

  return {
    changed: true,
    requirement: requirementFilter(
      nextCodes.length === 1 ? "single" : current.mode,
      nextCodes,
    ),
  };
}

function searchFilterValuesEqual(
  left: SearchRequestFiltersDto[keyof SearchRequestFiltersDto],
  right: SearchRequestFiltersDto[keyof SearchRequestFiltersDto],
): boolean {
  if (isRequirementFilterValue(left) || isRequirementFilterValue(right)) {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
  }
  return String(left ?? "").toLowerCase() === String(right ?? "").toLowerCase();
}

function isRequirementFilterValue(
  value: SearchRequestFiltersDto[keyof SearchRequestFiltersDto],
): value is NonNullable<SearchRequestFiltersDto["requirement"]> {
  return Boolean(
    value
      && typeof value === "object"
      && "mode" in value
      && "codes" in value,
  );
}

function removeTextFromQuery(source: string, textToRemove: string): string {
  const normalizedSource = source.trim();
  const normalizedRemove = textToRemove.trim();
  if (!normalizedRemove) return normalizedSource;

  const index = normalizedSource
    .toLowerCase()
    .indexOf(normalizedRemove.toLowerCase());

  if (index < 0) {
    return normalizedSource;
  }

  return `${normalizedSource.slice(0, index)} ${normalizedSource.slice(index + normalizedRemove.length)}`
    .replace(/\s+/g, " ")
    .trim();
}
