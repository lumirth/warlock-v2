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
export const SEARCH_PAGINATION_MAX_OFFSET = 1000;

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
  requirement?: string;
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

export const SEARCH_REQUEST_FILTER_KEYS = [
  "subject",
  "number",
  "instructor",
  "term",
  "year",
  "requirement",
  "credits",
  "days",
  "time",
  "partOfTerm",
  "online",
  "status",
  "workload",
  "level",
] as const satisfies readonly SearchRequestFilterKey[];

export type AdvancedSearchStateDto = SearchRequestFiltersDto & {
  scope?: SearchScope;
};

export const ADVANCED_SEARCH_STATE_KEYS = [
  ...SEARCH_REQUEST_FILTER_KEYS,
  "scope",
] as const satisfies readonly (keyof AdvancedSearchStateDto)[];

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
  return deepFreezeSearchContractValue({
    query: request.query,
    filters: compactSearchRequestFilters(request.filters),
    sort: normalizeSearchSortDto(request.sort),
    scope: normalizeSearchScopeDto(request.scope),
  });
}

export function searchRequestHasFilters(
  request: Pick<NormalizedSearchRequestDto, "filters">,
): boolean {
  return Object.values(request.filters).some((value) => value !== undefined);
}

export function splitAdvancedSearchState(
  state: AdvancedSearchStateDto | undefined,
): { filters: SearchRequestFiltersDto; scope?: SearchScope } {
  const { scope, ...filters } = state ?? {};
  return {
    filters: compactSearchRequestFilters(filters),
    scope,
  };
}

export function deepFreezeSearchContractValue<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }

  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreezeSearchContractValue((value as Record<string, unknown>)[key]);
  }

  return Object.freeze(value);
}

function normalizeSearchSortDto(sort: SearchRequestDto["sort"]): SearchSort {
  const field = isSearchSortField(sort?.field)
    ? sort.field
    : DEFAULT_SEARCH_SORT.field;
  const defaultDirection = SEARCH_SORT_DEFAULT_DIRECTIONS[field];
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
  return isSearchScope(scope) ? scope : DEFAULT_SEARCH_SCOPE;
}

function compactSearchRequestFilters(
  filters: SearchRequestDto["filters"],
): SearchRequestFiltersDto {
  if (!filters) return {};

  const compact: SearchRequestFiltersDto = {};
  const subject = normalizeSearchString(filters.subject, "upper");
  if (subject) compact.subject = subject;
  const number = normalizeSearchString(filters.number);
  if (number) compact.number = number;
  const instructor = normalizeSearchString(filters.instructor);
  if (instructor) compact.instructor = instructor;
  const term = normalizeEnumSearchString(filters.term, SEARCH_TERM_VALUES, "lower");
  if (term) compact.term = term;
  if (filters.year !== undefined) compact.year = filters.year;
  const requirement = normalizeSearchString(filters.requirement, "upper");
  if (requirement) compact.requirement = requirement;
  if (filters.credits !== undefined) compact.credits = filters.credits;
  const days = normalizeSearchString(filters.days, "upper");
  if (days) compact.days = days;
  const time = normalizeEnumSearchString(filters.time, SEARCH_TIME_VALUES, "lower");
  if (time) compact.time = time;
  const partOfTerm = normalizeSearchString(filters.partOfTerm, "upper");
  if (partOfTerm) compact.partOfTerm = partOfTerm;
  if (filters.online !== undefined) compact.online = filters.online;
  const status = normalizeEnumSearchString(
    filters.status,
    SEARCH_STATUS_VALUES,
    "lower",
  );
  if (status) compact.status = status;
  const workload = normalizeEnumSearchString(
    filters.workload,
    SEARCH_WORKLOAD_VALUES,
    "lower",
  );
  if (workload) compact.workload = workload;
  if (isSearchLevelFilter(filters.level)) compact.level = filters.level;

  return compact;
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
  allowed: readonly T[],
  casing?: "upper" | "lower",
): T | undefined {
  const normalized = normalizeSearchString(value, casing);
  return (allowed as readonly string[]).includes(normalized ?? "")
    ? (normalized as T)
    : undefined;
}

function includesSearchValue<const Values extends readonly unknown[]>(
  values: Values,
  value: unknown,
): value is Values[number] {
  return values.includes(value as Values[number]);
}
