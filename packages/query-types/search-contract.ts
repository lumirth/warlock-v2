import {
  REQUIREMENT_FILTER_MODES,
  requirementFilter,
  type RequirementFilter,
} from "./course-policy.js";
import { isKnownRequirementCode } from "./requirement-options.js";

export const SEARCH_SORT_FIELDS = [
  "relevance",
  "gpa",
  "quality",
  "workload",
  "instructor_rating",
  "level",
  "credits",
] as const;

export type SortField = (typeof SEARCH_SORT_FIELDS)[number];

export type SortDirection = "asc" | "desc";

export type SearchSort = {
  field: SortField;
  direction: SortDirection;
};

export const SEARCH_SORT_DEFAULT_DIRECTIONS: Record<
  SortField,
  SortDirection
> = {
  relevance: "desc",
  gpa: "desc",
  quality: "desc",
  workload: "asc",
  instructor_rating: "desc",
  level: "asc",
  credits: "asc",
} as const;

export const DEFAULT_SEARCH_SORT: SearchSort = {
  field: "relevance",
  direction: SEARCH_SORT_DEFAULT_DIRECTIONS.relevance,
} as const;

export const SEARCH_SCOPE_VALUES = ["active", "all"] as const;

export type SearchScope = (typeof SEARCH_SCOPE_VALUES)[number];

export const DEFAULT_SEARCH_SCOPE: SearchScope = "active";

export const SEARCH_TERM_VALUES = [
  "spring",
  "summer",
  "fall",
  "winter",
] as const;

export type SearchTermFilter = (typeof SEARCH_TERM_VALUES)[number];

export const SEARCH_TIME_VALUES = [
  "early",
  "morning",
  "midday",
  "afternoon",
  "evening",
] as const;

export type SearchTimeFilter = (typeof SEARCH_TIME_VALUES)[number];

export const SEARCH_STATUS_VALUES = [
  "open",
  "available",
  "closed",
] as const;

export type SearchStatusFilter = (typeof SEARCH_STATUS_VALUES)[number];

export const SEARCH_WORKLOAD_VALUES = ["easy", "hard"] as const;

export type SearchWorkloadFilter = (typeof SEARCH_WORKLOAD_VALUES)[number];

export const SEARCH_LEVEL_VALUES = [100, 200, 300, 400, 500] as const;

export type SearchLevelFilter = (typeof SEARCH_LEVEL_VALUES)[number];

export const SEARCH_PAGINATION_DEFAULT_LIMIT = 20;
export const SEARCH_PAGINATION_MAX_LIMIT = 50;
export const SEARCH_PAGINATION_MAX_OFFSET = 1_150;

export function isSearchSortField(value: unknown): value is SortField {
  return includesSearchValue(SEARCH_SORT_FIELDS, value);
}

export function isSearchScope(value: unknown): value is SearchScope {
  return includesSearchValue(SEARCH_SCOPE_VALUES, value);
}

export function isSearchTermFilter(value: unknown): value is SearchTermFilter {
  return includesSearchValue(SEARCH_TERM_VALUES, value);
}

export function isSearchTimeFilter(value: unknown): value is SearchTimeFilter {
  return includesSearchValue(SEARCH_TIME_VALUES, value);
}

export function isSearchStatusFilter(value: unknown): value is SearchStatusFilter {
  return includesSearchValue(SEARCH_STATUS_VALUES, value);
}

export function isSearchWorkloadFilter(
  value: unknown,
): value is SearchWorkloadFilter {
  return includesSearchValue(SEARCH_WORKLOAD_VALUES, value);
}

export function isSearchLevelFilter(value: unknown): value is SearchLevelFilter {
  return includesSearchValue(SEARCH_LEVEL_VALUES, value);
}

export type SearchRequestFiltersDto = {
  subject?: string;
  number?: string;
  instructor?: string;
  term?: SearchTermFilter;
  year?: number;
  requirement?: RequirementFilter;
  credits?: number;
  days?: string;
  time?: SearchTimeFilter;
  partOfTerm?: string;
  online?: boolean;
  status?: SearchStatusFilter;
  workload?: SearchWorkloadFilter;
  level?: SearchLevelFilter;
};

export type SearchRequestFilterKey = keyof SearchRequestFiltersDto;

export type AdvancedSearchStateDto = {
  filters: SearchRequestFiltersDto;
  scope?: SearchScope;
};

export type SearchPaginationDto = {
  limit?: number;
  offset?: number;
};

export type SearchRequestDto = {
  query: string;
  filters?: SearchRequestFiltersDto;
  sort?: SearchSort;
  scope?: SearchScope;
  pagination?: SearchPaginationDto;
};

export type NormalizedSearchRequestDto = {
  query: string;
  filters: SearchRequestFiltersDto;
  sort: SearchSort;
  scope: SearchScope;
};

export type SearchRequestPaginationDto = {
  limit: number;
  offset: number;
};

export function normalizeSearchRequestDto(
  request: SearchRequestDto,
): NormalizedSearchRequestDto {
  if (typeof request.query !== "string") {
    throw new TypeError("query must be a string");
  }
  return {
    query: request.query,
    filters: compactSearchRequestFilters(request.filters),
    sort: normalizeSearchSortDto(request.sort),
    scope: normalizeSearchScopeDto(request.scope),
  };
}

export function normalizeSearchPaginationDto(
  pagination: SearchPaginationDto | undefined,
): SearchRequestPaginationDto {
  const limit = pagination?.limit ?? SEARCH_PAGINATION_DEFAULT_LIMIT;
  const offset = pagination?.offset ?? 0;
  assertSearchInteger(limit, "limit", 1, SEARCH_PAGINATION_MAX_LIMIT);
  assertSearchInteger(offset, "offset", 0, SEARCH_PAGINATION_MAX_OFFSET);
  return { limit, offset };
}

export function searchRequestHasFilters(
  request: Pick<NormalizedSearchRequestDto, "filters">,
): boolean {
  return Object.values(request.filters).some((value) => value !== undefined);
}

export function splitAdvancedSearchState(
  state: AdvancedSearchStateDto | undefined,
): { filters: SearchRequestFiltersDto; scope?: SearchScope } {
  return {
    filters: compactSearchRequestFilters(state?.filters),
    scope: state?.scope,
  };
}

function normalizeSearchSortDto(sort: SearchRequestDto["sort"]): SearchSort {
  if (sort?.field !== undefined && !isSearchSortField(sort.field)) {
    throw new TypeError(`sort field must be one of: ${SEARCH_SORT_FIELDS.join(", ")}`);
  }
  const field = sort?.field ?? DEFAULT_SEARCH_SORT.field;
  const defaultDirection = SEARCH_SORT_DEFAULT_DIRECTIONS[field];
  if (
    sort?.direction !== undefined
    && sort.direction !== "asc"
    && sort.direction !== "desc"
  ) {
    throw new TypeError("sort direction must be one of: asc, desc");
  }
  const direction =
    sort?.direction === "asc" || sort?.direction === "desc"
      ? sort.direction
      : defaultDirection;

  return {
    field,
    direction: field === "relevance" ? defaultDirection : direction,
  };
}

function normalizeSearchScopeDto(scope: SearchRequestDto["scope"]): SearchScope {
  if (scope !== undefined && !isSearchScope(scope)) {
    throw new TypeError(`scope must be one of: ${SEARCH_SCOPE_VALUES.join(", ")}`);
  }
  return scope ?? DEFAULT_SEARCH_SCOPE;
}

function compactSearchRequestFilters(
  filters: SearchRequestDto["filters"],
): SearchRequestFiltersDto {
  if (!filters) return {};

  const compact: SearchRequestFiltersDto = {};
  const subject = normalizeSearchString(filters.subject, "upper");
  if (subject) {
    assertSearchPattern(subject, "subject", /^[A-Z]{2,4}$/, "a 2-4 letter subject code");
    compact.subject = subject;
  }
  const number = normalizeSearchString(filters.number);
  if (number) {
    assertSearchPattern(
      number,
      "number",
      /^\d{3}[A-Z]?$/,
      "a 3 digit catalog number with optional suffix",
    );
    compact.number = number;
  }
  const instructor = normalizeSearchString(filters.instructor);
  if (instructor) {
    if (instructor.length > 80) {
      throw new TypeError("instructor must be 80 characters or fewer");
    }
    compact.instructor = instructor;
  }
  const term = normalizeEnumSearchString(filters.term, "term", SEARCH_TERM_VALUES, "lower");
  if (term) compact.term = term;
  if (filters.year !== undefined) {
    assertSearchInteger(filters.year, "year", 2000, 2100);
    compact.year = filters.year;
  }
  const requirement = normalizeSearchRequirementFilter(filters.requirement);
  if (requirement) compact.requirement = requirement;
  if (filters.credits !== undefined) {
    assertSearchInteger(filters.credits, "credits", 0, 8);
    compact.credits = filters.credits;
  }
  const days = normalizeSearchString(filters.days, "upper");
  if (days) {
    assertSearchPattern(days, "days", /^[MTWRFSU]{1,7}$/, "meeting-day letters like MWF or TR");
    compact.days = days;
  }
  const time = normalizeEnumSearchString(filters.time, "time", SEARCH_TIME_VALUES, "lower");
  if (time) compact.time = time;
  const partOfTerm = normalizeSearchString(filters.partOfTerm, "upper");
  if (partOfTerm) {
    assertSearchPattern(
      partOfTerm,
      "partOfTerm",
      /^[A-Z0-9]$/,
      "a single Course Explorer part-of-term code",
    );
    compact.partOfTerm = partOfTerm;
  }
  if (filters.online !== undefined) {
    if (typeof filters.online !== "boolean") {
      throw new TypeError("online must be a boolean");
    }
    compact.online = filters.online;
  }
  const status = normalizeEnumSearchString(
    filters.status,
    "status",
    SEARCH_STATUS_VALUES,
    "lower",
  );
  if (status) compact.status = status;
  const workload = normalizeEnumSearchString(
    filters.workload,
    "workload",
    SEARCH_WORKLOAD_VALUES,
    "lower",
  );
  if (workload) compact.workload = workload;
  if (filters.level !== undefined) {
    if (!isSearchLevelFilter(filters.level)) {
      throw new TypeError(`level must be one of: ${SEARCH_LEVEL_VALUES.join(", ")}`);
    }
    compact.level = filters.level;
  }

  return compact;
}

function normalizeSearchRequirementFilter(
  value: SearchRequestFiltersDto["requirement"],
): RequirementFilter | undefined {
  if (!value) return undefined;
  if (!(REQUIREMENT_FILTER_MODES as readonly unknown[]).includes(value.mode)) {
    throw new TypeError(
      `requirement mode must be one of: ${REQUIREMENT_FILTER_MODES.join(", ")}`,
    );
  }
  for (const code of value.codes) {
    if (!isKnownRequirementCode(code)) {
      throw new TypeError(`unknown requirement code: ${code}`);
    }
  }
  const mode = value.mode;
  const codes = mode === "single" ? value.codes.slice(0, 1) : value.codes;
  if (mode === "single" && value.codes.length > 1) {
    throw new TypeError("single requirement filters must contain exactly one code");
  }
  return requirementFilter(mode, codes);
}

function normalizeSearchString(
  value: string | undefined,
  casing?: "upper" | "lower",
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (casing === "upper") return trimmed.toUpperCase();
  if (casing === "lower") return trimmed.toLowerCase();
  return trimmed;
}

function normalizeEnumSearchString<T extends string>(
  value: T | undefined,
  name: string,
  allowed: readonly T[],
  casing?: "upper" | "lower",
): T | undefined {
  const normalized = normalizeSearchString(value, casing);
  if (!normalized) return undefined;
  if (!(allowed as readonly string[]).includes(normalized)) {
    throw new TypeError(`${name} must be one of: ${allowed.join(", ")}`);
  }
  return normalized as T;
}

function assertSearchInteger(
  value: number,
  name: string,
  min: number,
  max: number,
): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TypeError(`${name} must be an integer between ${min} and ${max}`);
  }
}

function assertSearchPattern(
  value: string,
  name: string,
  pattern: RegExp,
  description: string,
): void {
  if (!pattern.test(value)) {
    throw new TypeError(`${name} must be ${description}`);
  }
}

function includesSearchValue<const Values extends readonly unknown[]>(
  values: Values,
  value: unknown,
): value is Values[number] {
  return values.includes(value as Values[number]);
}
