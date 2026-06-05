import {
  canonicalRequirementCode,
  canonicalRequirementCodes,
  coerceSearchRequestDto,
  GENED_REQUIREMENT_OPTIONS,
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
    query: cleanupQueryAfterIntentRemoval(
      removeTextFromQuery(request.query, textToRemove ?? ""),
      filter,
    ),
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
      removeRequirementTermsForCodes(query, removedCodeSet),
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

function removeRequirementTermsForCodes(
  query: string,
  removedCodes: ReadonlySet<string>,
): string {
  let nextQuery = query;
  for (const term of requirementTermsForCodes(removedCodes)) {
    nextQuery = removeRequirementPhraseFromQuery(nextQuery, term);
  }
  return nextQuery;
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

function requirementTermsForCodes(removedCodes: ReadonlySet<string>): string[] {
  const terms = new Set<string>();
  for (const option of GENED_REQUIREMENT_OPTIONS) {
    const code = canonicalRequirementCode(option.code);
    if (!code || !removedCodes.has(code)) continue;
    for (const term of requirementOptionTerms(option)) {
      terms.add(term);
    }
  }
  return Array.from(terms).sort((left, right) => right.length - left.length);
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

function removeRequirementPhraseFromQuery(query: string, phrase: string): string {
  const tokens = phrase.toLowerCase().match(/[a-z0-9+#]+/g);
  if (!tokens?.length) return query;

  const body = tokens.map(escapeRegex).join("[\\s/_&-]+");
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
