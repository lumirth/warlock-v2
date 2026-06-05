import {
  DEFAULT_SEARCH_SCOPE,
  DEFAULT_SEARCH_SORT,
  SEARCH_PAGINATION_DEFAULT_LIMIT,
  SEARCH_PAGINATION_MAX_LIMIT,
  SEARCH_PAGINATION_MAX_OFFSET,
  SEARCH_LEVEL_VALUES,
  SEARCH_SCOPE_VALUES,
  SEARCH_SORT_DEFAULT_DIRECTIONS,
  SEARCH_SORT_FIELDS,
  SEARCH_STATUS_VALUES,
  SEARCH_TERM_VALUES,
  SEARCH_TIME_VALUES,
  SEARCH_WORKLOAD_VALUES,
  isSearchLevelFilter,
  isSearchScope,
  isSearchSortField,
  coerceSearchRequestDto,
  searchRequestHasFilters,
  type NormalizedSearchRequestDto,
  type SearchPaginationDto,
  type SearchLevelFilter,
  type SearchRequestDto,
  type SearchRequestPaginationDto,
  type SearchScope,
  type SearchSort,
} from "./search-contract.js";
import {
  REQUIREMENT_FILTER_MODES,
  requirementFilter,
  type RequirementFilter,
  type RequirementFilterMode,
} from "./course-policy.js";
import { isKnownRequirementCode } from "./requirement-options.js";

export type SearchQueryParamReader = {
  get(name: string): string | null;
};

export type DecodedSearchRequestQuery = Readonly<{
  request: NormalizedSearchRequestDto;
  pagination: SearchRequestPaginationDto;
}>;

export type SearchRequestQueryDecodeResult =
  | { ok: true; value: DecodedSearchRequestQuery }
  | { ok: false; error: string };

type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export function searchRequestToQueryEntries(
  request: SearchRequestDto,
): Array<[string, string]> {
  const normalized = coerceSearchRequestDto(request);
  const entries: Array<[string, string]> = [["q", normalized.query]];

  for (const [key, value] of searchPaginationToQueryEntries(request.pagination)) {
    entries.push([key, value]);
  }

  const { filters } = normalized;
  if (filters.subject) entries.push(["subject", filters.subject]);
  if (filters.number) entries.push(["number", filters.number]);
  if (filters.instructor) entries.push(["instructor", filters.instructor]);
  if (filters.term) entries.push(["term", filters.term]);
  if (filters.year !== undefined) entries.push(["year", String(filters.year)]);
  if (filters.requirement) {
    entries.push(["requirement", filters.requirement.codes.join(",")]);
    if (filters.requirement.mode !== "single") {
      entries.push(["requirementMode", filters.requirement.mode]);
    }
  }
  if (filters.credits !== undefined) entries.push(["credits", String(filters.credits)]);
  if (filters.days) entries.push(["days", filters.days]);
  if (filters.time) entries.push(["time", filters.time]);
  if (filters.partOfTerm) entries.push(["partOfTerm", filters.partOfTerm]);
  if (filters.online !== undefined) entries.push(["online", String(filters.online)]);
  if (filters.status) entries.push(["status", filters.status]);
  if (filters.workload) entries.push(["workload", filters.workload]);
  if (filters.level !== undefined) entries.push(["level", String(filters.level)]);

  if (normalized.scope !== DEFAULT_SEARCH_SCOPE) {
    entries.push(["scope", normalized.scope]);
  }

  if (normalized.sort.field !== DEFAULT_SEARCH_SORT.field) {
    entries.push(["sort", normalized.sort.field]);
    entries.push(["direction", normalized.sort.direction]);
  }

  return entries;
}

export function decodeSearchRequestQuery(
  params: SearchQueryParamReader,
): SearchRequestQueryDecodeResult {
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

  const parsedSort = parseSearchSortParams(params.get("sort"), params.get("direction"));
  if (!parsedSort.ok) return parsedSort;

  const parsedScope = parseSearchScopeParam(params.get("scope"));
  if (!parsedScope.ok) return parsedScope;

  const requestInput: SearchRequestDto = {
    query: params.get("q") ?? "",
    filters: {},
    sort: parsedSort.value,
    scope: parsedScope.value,
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
    const parsedTerm = parseSearchEnumParam(term.toLowerCase(), "term", SEARCH_TERM_VALUES);
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

  const requirement = parseSearchRequirementParam(
    params.get("requirement"),
    params.get("requirementMode"),
  );
  if (!requirement.ok) return requirement;
  if (requirement.value) requestInput.filters!.requirement = requirement.value;

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
    const parsedTime = parseSearchEnumParam(time.toLowerCase(), "time", SEARCH_TIME_VALUES);
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
    const parsedStatus = parseSearchEnumParam(status.toLowerCase(), "status", SEARCH_STATUS_VALUES);
    if (!parsedStatus.ok) return parsedStatus;
    requestInput.filters!.status = parsedStatus.value;
  }

  const workload = params.get("workload");
  if (workload) {
    const parsedWorkload = parseSearchEnumParam(
      workload.toLowerCase(),
      "workload",
      SEARCH_WORKLOAD_VALUES,
    );
    if (!parsedWorkload.ok) return parsedWorkload;
    requestInput.filters!.workload = parsedWorkload.value;
  }

  const level = parseSearchLevelParam(params.get("level"));
  if (!level.ok) return level;
  if (level.value !== undefined) {
    requestInput.filters!.level = level.value;
  }

  const request = coerceSearchRequestDto(requestInput);
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

function searchPaginationToQueryEntries(
  pagination: SearchPaginationDto | undefined,
): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  if (pagination?.limit !== undefined) {
    entries.push(["limit", String(pagination.limit)]);
  }
  if (pagination?.offset !== undefined) {
    entries.push(["offset", String(pagination.offset)]);
  }
  return entries;
}

function parseBoundedSearchIntParam(
  raw: string | null,
  name: string,
  options: { min: number; max: number; defaultValue?: number },
): ParseResult<number> {
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
): ParseResult<T> {
  if ((allowed as readonly string[]).includes(raw)) {
    return { ok: true, value: raw as T };
  }
  return { ok: false, error: `${name} must be one of: ${allowed.join(", ")}` };
}

function parseSearchSubjectParam(raw: string): ParseResult<string> {
  const subject = raw.trim().toUpperCase();
  if (/^[A-Z]{2,4}$/.test(subject)) {
    return { ok: true, value: subject };
  }
  return { ok: false, error: "subject must be a 2-4 letter subject code" };
}

function parseSearchCourseNumberParam(raw: string): ParseResult<string> {
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
): ParseResult<boolean> {
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

function parseSearchRequirementParam(
  codesRaw: string | null,
  modeRaw: string | null,
): ParseResult<RequirementFilter | undefined> {
  const normalizedMode = modeRaw?.trim().toLowerCase();
  if (normalizedMode && !isRequirementFilterMode(normalizedMode)) {
    return {
      ok: false,
      error: `requirementMode must be one of: ${REQUIREMENT_FILTER_MODES.join(", ")}`,
    };
  }

  const codes = (codesRaw ?? "")
    .split(",")
    .map(code => code.trim().toUpperCase())
    .filter(Boolean);
  if (codes.length === 0) {
    return { ok: true, value: undefined };
  }

  const mode: RequirementFilterMode = normalizedMode && isRequirementFilterMode(normalizedMode)
    ? normalizedMode
    : codes.length > 1
      ? "any"
      : "single";
  if (mode === "single" && codes.length > 1) {
    return {
      ok: false,
      error: "requirement must contain one code when requirementMode is single",
    };
  }

  for (const code of codes) {
    if (!/^[A-Z0-9]{2,8}$/.test(code)) {
      return {
        ok: false,
        error: "requirement codes must be 2-8 letters or digits",
      };
    }
    if (!isKnownRequirementCode(code)) {
      return {
        ok: false,
        error: `unknown requirement code: ${code}`,
      };
    }
  }

  return { ok: true, value: requirementFilter(mode, codes) };
}

function isRequirementFilterMode(
  value: string,
): value is RequirementFilterMode {
  return (REQUIREMENT_FILTER_MODES as readonly string[]).includes(value);
}

function parseSearchSortParams(
  fieldRaw: string | null,
  directionRaw: string | null,
): ParseResult<SearchSort> {
  const normalizedField = fieldRaw?.trim().toLowerCase();
  if (normalizedField && !isSearchSortField(normalizedField)) {
    return {
      ok: false,
      error: `sort must be one of: ${SEARCH_SORT_FIELDS.join(", ")}`,
    };
  }
  const field = isSearchSortField(normalizedField) ? normalizedField : DEFAULT_SEARCH_SORT.field;
  const normalizedDirection = directionRaw?.trim().toLowerCase();
  if (
    normalizedDirection
    && normalizedDirection !== "asc"
    && normalizedDirection !== "desc"
  ) {
    return { ok: false, error: "direction must be one of: asc, desc" };
  }
  const defaultDirection = SEARCH_SORT_DEFAULT_DIRECTIONS[field];
  const direction =
    normalizedDirection === "asc" || normalizedDirection === "desc"
      ? normalizedDirection
      : defaultDirection;

  return {
    ok: true,
    value: {
      field,
      direction: field === "relevance" ? defaultDirection : direction,
    },
  };
}

function parseSearchScopeParam(raw: string | null): ParseResult<SearchScope> {
  const normalized = raw?.trim().toLowerCase();
  if (!normalized) return { ok: true, value: DEFAULT_SEARCH_SCOPE };
  if (isSearchScope(normalized)) return { ok: true, value: normalized };
  return {
    ok: false,
    error: `scope must be one of: ${SEARCH_SCOPE_VALUES.join(", ")}`,
  };
}

function parseSearchLevelParam(
  raw: string | null,
): ParseResult<SearchLevelFilter | undefined> {
  if (!raw) return { ok: true, value: undefined };

  const normalized = raw.trim();
  if (!/^\d+$/.test(normalized)) {
    return { ok: false, error: "level must be an integer" };
  }

  const value = Number.parseInt(normalized, 10);
  if (isSearchLevelFilter(value)) return { ok: true, value };
  return {
    ok: false,
    error: `level must be one of: ${SEARCH_LEVEL_VALUES.join(", ")}`,
  };
}
