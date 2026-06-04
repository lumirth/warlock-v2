import {
  DEFAULT_SEARCH_SCOPE,
  DEFAULT_SEARCH_SORT,
  SEARCH_DIFFICULTY_VALUES,
  SEARCH_PAGINATION_DEFAULT_LIMIT,
  SEARCH_PAGINATION_MAX_LIMIT,
  SEARCH_PAGINATION_MAX_OFFSET,
  SEARCH_SORT_DEFAULT_DIRECTIONS,
  SEARCH_STATUS_VALUES,
  SEARCH_TERM_VALUES,
  SEARCH_TIME_VALUES,
  isSearchLevelFilter,
  isSearchScope,
  isSearchSortField,
  normalizeSearchRequestDto,
  searchRequestHasFilters,
  type SearchRequestDto,
  type SearchScope,
  type SearchSort,
} from "@uiuc-course-search/query-types";
import type { CanonicalSearchRequest } from "../services/search-request.js";
import type { ParsedParam } from "./params.js";

export type SearchRequestPagination = Readonly<{
  limit: number;
  offset: number;
}>;

export type ParsedSearchHttpRequest = Readonly<{
  request: CanonicalSearchRequest;
  pagination: SearchRequestPagination;
}>;

export function parseSearchHttpRequest(
  params: URLSearchParams,
): ParsedParam<ParsedSearchHttpRequest> {
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

type ParseResult<T> = ParsedParam<T>;

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

function parseSearchLevelParam(raw: string | null) {
  if (!raw) return undefined;

  const normalized = raw.trim();
  if (!/^\d+$/.test(normalized)) return undefined;

  const value = Number.parseInt(normalized, 10);
  return isSearchLevelFilter(value) ? value : undefined;
}
