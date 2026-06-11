import {
  canonicalRequirementCode,
  canonicalRequirementCodes,
  normalizeSearchRequestDto,
  GENED_REQUIREMENT_OPTIONS,
  requirementFilter,
  searchRequestHasFilters,
  type NormalizedSearchRequestDto,
  type SearchRequestDto,
  type SearchRequestFiltersDto,
} from "@uiuc-course-search/query-types";
import { meaningfulResidualQuery } from "./search-request-text.js";

export type SearchIntentRemoval =
  | {
      kind: "filter";
      filter: Partial<SearchRequestFiltersDto>;
    }
  | {
      kind: "query_phrase";
      phrase: string;
      removedFilter?: Partial<SearchRequestFiltersDto>;
    }
  | {
      kind: "query_terms";
      terms: string;
    }
  | {
      kind: "filter_or_query_phrase";
      filter: Partial<SearchRequestFiltersDto>;
      phrase: string;
    };

function publicSearchRequest(
  request: SearchRequestDto,
): SearchRequestDto {
  const normalized = normalizeSearchRequestDto(request);
  return {
    query: normalized.query,
    filters: searchRequestHasFilters(normalized) ? normalized.filters : undefined,
    sort: normalized.sort,
    scope: normalized.scope,
  };
}

export function removeSearchIntentRequest(
  request: NormalizedSearchRequestDto,
  removal: SearchIntentRemoval,
): SearchRequestDto {
  if (removal.kind === "filter" || removal.kind === "filter_or_query_phrase") {
    const withoutFilter = requestWithoutMatchingFilter(request, removal.filter);
    if (withoutFilter) {
      return publicSearchRequest(withoutFilter);
    }
  }

  if (removal.kind === "filter") {
    throw new Error("Cannot remove a search filter that is not present");
  }

  const removedFilter = removal.kind === "query_phrase"
    ? removal.removedFilter
    : removal.kind === "filter_or_query_phrase"
      ? removal.filter
      : undefined;
  const queryWithoutIntent = removal.kind === "query_terms"
    ? removeQueryTerms(request.query, removal.terms)
    : removeQueryPhrase(request.query, removal.phrase);
  const query = cleanupQueryAfterIntentRemoval(
    queryWithoutIntent,
    removedFilter,
  );
  const nextRequest = publicSearchRequest({
    ...request,
    query,
  });
  if (nextRequest.query === request.query) {
    const missing = removal.kind === "query_terms" ? removal.terms : removal.phrase;
    throw new Error(`Cannot remove missing search text: ${missing}`);
  }
  return nextRequest;
}

export function ambiguitySearchRequest(
  request: NormalizedSearchRequestDto,
  baseFilters: SearchRequestFiltersDto,
  filter: Partial<SearchRequestFiltersDto>,
  residual: string,
): SearchRequestDto {
  return publicSearchRequest(
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

function removeQueryPhrase(source: string, phrase: string): string {
  const normalizedSource = source.trim();
  const normalizedPhrase = phrase.trim();
  if (!normalizedPhrase) return normalizedSource;
  return removePhraseFromQuery(normalizedSource, normalizedPhrase);
}

function removeQueryTerms(source: string, terms: string): string {
  const tokens = terms.match(/[a-z0-9+#]+/gi) ?? [];
  return tokens.reduce(removePhraseFromQuery, source.trim());
}

function cleanupQueryAfterIntentRemoval(
  query: string,
  filter: Partial<SearchRequestFiltersDto> | undefined,
): string {
  const removedRequirementCodes = requirementCodesFromFilter(filter);
  if (removedRequirementCodes.length === 0) return query;

  return cleanupQueryAfterRequirementRemoval(query, removedRequirementCodes);
}

function requirementCodesFromFilter(
  filter: Partial<SearchRequestFiltersDto> | undefined,
): string[] {
  if (!filter || !isRequirementFilterValue(filter.requirement)) return [];
  return canonicalRequirementCodes(filter.requirement.codes);
}

function cleanupQueryAfterRequirementRemoval(
  query: string,
  removedCodes: readonly string[],
): string {
  const removedCodeSet = new Set(canonicalRequirementCodes(removedCodes));
  const withoutRemovedRequirementTerms = cleanupDanglingConnectors(
    cleanupRequirementCueConnectors(
      query,
    ),
  );

  if (containsConcreteRequirementTerm(withoutRemovedRequirementTerms, removedCodeSet)) {
    return withoutRemovedRequirementTerms;
  }

  return cleanupDanglingConnectors(
    withoutRemovedRequirementTerms
      .replace(/\bgen[\s-]?eds?\b/gi, " ")
      .replace(/\bgeneral\s+education\b/gi, " ")
      .replace(/\brequirements?\b/gi, " ")
      .replace(/\bcategor(?:y|ies)\b/gi, " "),
  );
}

function cleanupRequirementCueConnectors(query: string): string {
  return query
    .replace(
      /\s+(?:and|or)\s+(?=(?:gen[\s-]?eds?|general\s+education|requirements?|categor(?:y|ies))\b)/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function containsConcreteRequirementTerm(
  query: string,
  ignoredCodes: ReadonlySet<string>,
): boolean {
  for (const option of GENED_REQUIREMENT_OPTIONS) {
    const code = canonicalRequirementCode(option.code);
    if (!code || ignoredCodes.has(code)) continue;
    if (requirementOptionTerms(option).some(term => queryContainsPhrase(query, term))) {
      return true;
    }
  }
  return false;
}

function requirementOptionTerms(
  option: (typeof GENED_REQUIREMENT_OPTIONS)[number],
): string[] {
  return [
    option.code,
    option.label,
    ...option.aliases,
  ].filter(Boolean);
}

function queryContainsPhrase(query: string, phrase: string): boolean {
  const normalizedQuery = normalizePhrase(query);
  const normalizedPhrase = normalizePhrase(phrase);
  if (!normalizedQuery || !normalizedPhrase) return false;
  return new RegExp(`(?:^|\\s)${escapeRegex(normalizedPhrase)}(?=$|\\s)`, "i")
    .test(normalizedQuery);
}

function removePhraseFromQuery(query: string, phrase: string): string {
  const tokens = phrase.toLowerCase().match(/[a-z0-9+#]+/g);
  if (!tokens?.length) return query;

  const body = tokens.map(escapeRegex).join("[^a-z0-9+#]+");
  return query
    .replace(new RegExp(`(^|[^a-z0-9+#])${body}(?=$|[^a-z0-9+#])`, "gi"), " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePhrase(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9+#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanupDanglingConnectors(query: string): string {
  return query
    .replace(/\s+/g, " ")
    .replace(/^\s*(?:and|or|,)+\s*/i, "")
    .replace(/\s*(?:and|or|,)+\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
