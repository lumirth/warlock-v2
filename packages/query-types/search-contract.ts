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

export const SEARCH_DIFFICULTY_VALUES = ["easy", "hard"] as const;

export type SearchDifficultyFilter = (typeof SEARCH_DIFFICULTY_VALUES)[number];

export const SEARCH_LEVEL_VALUES = [100, 200, 300, 400, 500] as const;

export type SearchLevelFilter = (typeof SEARCH_LEVEL_VALUES)[number];

export const SEARCH_PAGINATION_DEFAULT_LIMIT = 20;
export const SEARCH_PAGINATION_MAX_LIMIT = 50;
export const SEARCH_PAGINATION_MAX_OFFSET = 1000;

export type SearchSelectOption<T extends string | number = string> = {
  value: T;
  label: string;
};

export const SEARCH_TERM_OPTIONS: readonly SearchSelectOption<SearchTermFilter>[] = [
  { value: "spring", label: "Spring" },
  { value: "summer", label: "Summer" },
  { value: "fall", label: "Fall" },
  { value: "winter", label: "Winter" },
] as const;

export const SEARCH_TIME_OPTIONS: readonly SearchSelectOption<SearchTimeFilter>[] = [
  { value: "morning", label: "Morning" },
  { value: "afternoon", label: "Afternoon" },
  { value: "evening", label: "Evening" },
] as const;

export const SEARCH_STATUS_OPTIONS: readonly SearchSelectOption<SearchStatusFilter>[] = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
] as const;

export const SEARCH_WORKLOAD_OPTIONS: readonly SearchSelectOption<SearchDifficultyFilter>[] = [
  { value: "easy", label: "Easier" },
  { value: "hard", label: "Harder" },
] as const;

export const SEARCH_LEVEL_OPTIONS: readonly SearchSelectOption<SearchLevelFilter>[] = [
  { value: 100, label: "100 level" },
  { value: 200, label: "200 level" },
  { value: 300, label: "300 level" },
  { value: 400, label: "400 level" },
  { value: 500, label: "500+ level" },
] as const;

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

export function isSearchDifficultyFilter(
  value: unknown,
): value is SearchDifficultyFilter {
  return includesSearchValue(SEARCH_DIFFICULTY_VALUES, value);
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
  gened?: string;
  credits?: number;
  days?: string;
  time?: SearchTimeFilter;
  partOfTerm?: string;
  online?: boolean;
  status?: SearchStatusFilter;
  difficulty?: SearchDifficultyFilter;
  level?: SearchLevelFilter;
};

export type SearchRequestFilterKey = keyof SearchRequestFiltersDto;

export type SearchRequestFilterPatchDto = Partial<SearchRequestFiltersDto>;

export type AdvancedSearchStateDto = SearchRequestFiltersDto & {
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

export type ParsedSearchRequestQuery = {
  request: NormalizedSearchRequestDto;
  pagination: SearchRequestPaginationDto;
};

export type SearchContractParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export type SearchQueryParamReader = {
  get(name: string): string | null;
};

export type SearchQueryParamEntry = readonly [string, string];

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

export function searchRequestToQueryEntries(
  request: SearchRequestDto,
): SearchQueryParamEntry[] {
  const normalized = normalizeSearchRequestDto(request);
  const entries: SearchQueryParamEntry[] = [["q", normalized.query]];

  if (request.pagination?.limit !== undefined) {
    entries.push(["limit", String(request.pagination.limit)]);
  }
  if (request.pagination?.offset !== undefined) {
    entries.push(["offset", String(request.pagination.offset)]);
  }

  appendSearchFilterEntries(entries, normalized.filters);

  if (normalized.scope !== DEFAULT_SEARCH_SCOPE) {
    entries.push(["scope", normalized.scope]);
  }

  if (normalized.sort.field !== DEFAULT_SEARCH_SORT.field) {
    entries.push(["sort", normalized.sort.field]);
    entries.push(["direction", normalized.sort.direction]);
  }

  return entries;
}

export function parseSearchRequestQueryParams(
  params: SearchQueryParamReader,
): SearchContractParseResult<ParsedSearchRequestQuery> {
  const parsedLimit = parseBoundedSearchIntParam(params.get("limit"), "limit", {
    min: 1,
    max: SEARCH_PAGINATION_MAX_LIMIT,
    defaultValue: SEARCH_PAGINATION_DEFAULT_LIMIT,
  });
  if (!parsedLimit.ok) return parsedLimit;

  const parsedOffset = parseBoundedSearchIntParam(params.get("offset"), "offset", {
    min: 0,
    max: SEARCH_PAGINATION_MAX_OFFSET,
    defaultValue: 0,
  });
  if (!parsedOffset.ok) return parsedOffset;

  const requestInput: SearchRequestDto = {
    query: params.get("q") ?? "",
    filters: {},
    sort: parseSearchSortParams(params.get("sort"), params.get("direction")),
    scope: parseSearchScopeParam(params.get("scope")),
  };

  const subject = params.get("subject");
  if (subject) {
    const parsedSubject = parseSearchSubjectParam(subject);
    if (!parsedSubject.ok) return parsedSubject;
    requestInput.filters!.subject = parsedSubject.value;
  }

  const number = params.get("number");
  if (number) {
    const parsedNumber = parseSearchCourseNumberParam(number);
    if (!parsedNumber.ok) return parsedNumber;
    requestInput.filters!.number = parsedNumber.value;
  }

  const instructor = params.get("instructor")?.trim();
  if (instructor) {
    if (instructor.length > 80) {
      return { ok: false, error: "instructor must be 80 characters or fewer" };
    }
    requestInput.filters!.instructor = instructor;
  }

  const term = params.get("term");
  if (term) {
    const parsedTerm = parseSearchEnumParam(
      term.toLowerCase(),
      "term",
      SEARCH_TERM_VALUES,
    );
    if (!parsedTerm.ok) return parsedTerm;
    requestInput.filters!.term = parsedTerm.value;
  }

  const year = params.get("year");
  if (year) {
    const parsedYear = parseBoundedSearchIntParam(year, "year", {
      min: 2000,
      max: 2100,
    });
    if (!parsedYear.ok) return parsedYear;
    requestInput.filters!.year = parsedYear.value;
  }

  const gened = params.get("gened")?.trim();
  if (gened) requestInput.filters!.gened = gened.toUpperCase();

  const credits = params.get("credits");
  if (credits) {
    const parsedCredits = parseBoundedSearchIntParam(credits, "credits", {
      min: 0,
      max: 8,
    });
    if (!parsedCredits.ok) return parsedCredits;
    requestInput.filters!.credits = parsedCredits.value;
  }

  const days = params.get("days")?.trim().toUpperCase();
  if (days) {
    if (!/^[MTWRFSU]{1,7}$/.test(days)) {
      return {
        ok: false,
        error: "days must use meeting-day letters like MWF or TR",
      };
    }
    requestInput.filters!.days = days;
  }

  const time = params.get("time");
  if (time) {
    const parsedTime = parseSearchEnumParam(
      time.toLowerCase(),
      "time",
      SEARCH_TIME_VALUES,
    );
    if (!parsedTime.ok) return parsedTime;
    requestInput.filters!.time = parsedTime.value;
  }

  const partOfTerm =
    params.get("partOfTerm") ?? params.get("part_of_term") ?? params.get("pot");
  if (partOfTerm) {
    const normalizedPartOfTerm = partOfTerm.trim().toUpperCase();
    if (!/^[A-Z0-9]$/.test(normalizedPartOfTerm)) {
      return {
        ok: false,
        error:
          "partOfTerm must be a single Course Explorer part-of-term code like 1, A, or B",
      };
    }
    requestInput.filters!.partOfTerm = normalizedPartOfTerm;
  }

  const online = params.get("online");
  if (online) {
    const parsedOnline = parseSearchBooleanParam(online, "online");
    if (!parsedOnline.ok) return parsedOnline;
    requestInput.filters!.online = parsedOnline.value;
  }

  const status = params.get("status");
  if (status) {
    const parsedStatus = parseSearchEnumParam(
      status.toLowerCase(),
      "status",
      SEARCH_STATUS_VALUES,
    );
    if (!parsedStatus.ok) return parsedStatus;
    requestInput.filters!.status = parsedStatus.value;
  }

  const difficulty = params.get("difficulty");
  if (difficulty) {
    const parsedDifficulty = parseSearchEnumParam(
      difficulty.toLowerCase(),
      "difficulty",
      SEARCH_DIFFICULTY_VALUES,
    );
    if (!parsedDifficulty.ok) return parsedDifficulty;
    requestInput.filters!.difficulty = parsedDifficulty.value;
  }

  const level = parseSearchLevelParam(params.get("level"));
  if (level !== undefined) {
    requestInput.filters!.level = level;
  }

  const request = normalizeSearchRequestDto(requestInput);
  if (!request.query.trim() && !searchRequestHasFilters(request)) {
    return { ok: false, error: "Missing query parameter q" };
  }

  return {
    ok: true,
    value: {
      request,
      pagination: {
        limit: parsedLimit.value,
        offset: parsedOffset.value,
      },
    },
  };
}

export function searchRequestCachePayload(
  request: NormalizedSearchRequestDto,
): Record<string, unknown> {
  return {
    query: normalizeSearchQueryForKey(request.query),
    filters: stableSearchRecord(request.filters),
    sort: stableSearchRecord(request.sort),
    scope: request.scope,
  };
}

export function searchPlanRequestCachePayload(
  request: NormalizedSearchRequestDto,
): Record<string, unknown> {
  return {
    query: normalizeSearchQueryForKey(request.query),
    filters: stableSearchRecord(request.filters),
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
  const gened = normalizeSearchString(filters.gened, "upper");
  if (gened) compact.gened = gened;
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
  const difficulty = normalizeEnumSearchString(
      filters.difficulty,
      SEARCH_DIFFICULTY_VALUES,
      "lower",
    );
  if (difficulty) compact.difficulty = difficulty;
  if (isSearchLevelFilter(filters.level)) compact.level = filters.level;

  return compact;
}

function appendSearchFilterEntries(
  entries: SearchQueryParamEntry[],
  filters: SearchRequestFiltersDto,
): void {
  if (filters.subject) entries.push(["subject", filters.subject]);
  if (filters.number) entries.push(["number", filters.number]);
  if (filters.instructor) entries.push(["instructor", filters.instructor]);
  if (filters.term) entries.push(["term", filters.term]);
  if (filters.year !== undefined) entries.push(["year", String(filters.year)]);
  if (filters.gened) entries.push(["gened", filters.gened]);
  if (filters.credits !== undefined) {
    entries.push(["credits", String(filters.credits)]);
  }
  if (filters.days) entries.push(["days", filters.days]);
  if (filters.time) entries.push(["time", filters.time]);
  if (filters.partOfTerm) entries.push(["partOfTerm", filters.partOfTerm]);
  if (filters.online !== undefined) entries.push(["online", String(filters.online)]);
  if (filters.status) entries.push(["status", filters.status]);
  if (filters.difficulty) entries.push(["difficulty", filters.difficulty]);
  if (filters.level !== undefined) entries.push(["level", String(filters.level)]);
}

function parseBoundedSearchIntParam(
  raw: string | null,
  name: string,
  options: { min: number; max: number; defaultValue?: number },
): SearchContractParseResult<number> {
  if (raw === null || raw === "") {
    if (options.defaultValue !== undefined) {
      return { ok: true, value: options.defaultValue };
    }
    return { ok: false, error: `${name} is required` };
  }

  if (!/^-?\d+$/.test(raw)) {
    return { ok: false, error: `${name} must be an integer` };
  }

  const value = Number.parseInt(raw, 10);
  if (value < options.min || value > options.max) {
    return {
      ok: false,
      error: `${name} must be between ${options.min} and ${options.max}`,
    };
  }

  return { ok: true, value };
}

function parseSearchEnumParam<T extends string>(
  raw: string,
  name: string,
  allowed: readonly T[],
): SearchContractParseResult<T> {
  if ((allowed as readonly string[]).includes(raw)) {
    return { ok: true, value: raw as T };
  }
  return { ok: false, error: `${name} must be one of: ${allowed.join(", ")}` };
}

function parseSearchSubjectParam(raw: string): SearchContractParseResult<string> {
  const subject = raw.trim().toUpperCase();
  if (/^[A-Z]{2,4}$/.test(subject)) {
    return { ok: true, value: subject };
  }
  return { ok: false, error: "subject must be a 2-4 letter subject code" };
}

function parseSearchCourseNumberParam(
  raw: string,
): SearchContractParseResult<string> {
  const number = raw.trim();
  if (/^\d{3}[A-Z]?$/.test(number)) {
    return { ok: true, value: number };
  }
  return {
    ok: false,
    error: "number must be a 3 digit catalog number with optional suffix",
  };
}

function parseSearchBooleanParam(
  raw: string,
  name: string,
): SearchContractParseResult<boolean> {
  const normalized = raw.trim().toLowerCase();
  if (["true", "1", "yes", "online", "remote"].includes(normalized)) {
    return { ok: true, value: true };
  }
  if (
    ["false", "0", "no", "in-person", "in_person", "inperson"].includes(
      normalized,
    )
  ) {
    return { ok: true, value: false };
  }
  return { ok: false, error: `${name} must be a boolean` };
}

function parseSearchSortParams(
  fieldRaw: string | null,
  directionRaw: string | null,
): SearchSort {
  const normalizedField = fieldRaw?.trim().toLowerCase();
  const field = isSearchSortField(normalizedField)
    ? normalizedField
    : DEFAULT_SEARCH_SORT.field;
  const normalizedDirection = directionRaw?.trim().toLowerCase();
  const defaultDirection = SEARCH_SORT_DEFAULT_DIRECTIONS[field];
  const direction =
    normalizedDirection === "asc" || normalizedDirection === "desc"
      ? normalizedDirection
      : defaultDirection;

  return {
    field,
    direction: field === "relevance" ? defaultDirection : direction,
  };
}

function parseSearchScopeParam(raw: string | null): SearchScope {
  const normalized = raw?.trim().toLowerCase();
  return isSearchScope(normalized) ? normalized : DEFAULT_SEARCH_SCOPE;
}

function parseSearchLevelParam(raw: string | null): SearchLevelFilter | undefined {
  if (!raw) return undefined;

  const normalized = raw.trim();
  if (!/^\d+$/.test(normalized)) return undefined;

  const value = Number.parseInt(normalized, 10);
  return isSearchLevelFilter(value) ? value : undefined;
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

function stableSearchRecord(value: object | undefined): Record<string, unknown> {
  if (!value) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function normalizeSearchQueryForKey(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function includesSearchValue<const Values extends readonly unknown[]>(
  values: Values,
  value: unknown,
): value is Values[number] {
  return values.includes(value as Values[number]);
}
