import {
  normalizeSearchRequestDto,
  searchRequestHasFilters,
  type NormalizedSearchRequestDto,
  type SearchActionDto,
  type SearchRequestDto,
  type SearchRequestFiltersDto,
} from "@uiuc-course-search/query-types";

export function searchActionFromRequest(
  request: SearchRequestDto,
): SearchActionDto {
  const normalized = normalizeSearchRequestDto(request);
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
  if (filter.gened) {
    delete nextFilters.subject;
    delete nextFilters.number;
    nextFilters.gened = filter.gened;
  }
  if (filter.subject) {
    delete nextFilters.gened;
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
    if (String(nextFilters[key] ?? "").toLowerCase() !== String(value).toLowerCase()) {
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

function meaningfulResidualQuery(residual: string): string {
  const weakResidualTerms = new Set([
    "a",
    "an",
    "and",
    "by",
    "class",
    "classes",
    "course",
    "courses",
    "find",
    "for",
    "in",
    "intro",
    "introduction",
    "of",
    "search",
    "the",
    "to",
  ]);
  const trimmedResidual = residual.trim();
  const meaningfulTokens = trimmedResidual
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter((token) => token && !weakResidualTerms.has(token));

  return meaningfulTokens.length > 0 ? trimmedResidual : "";
}
