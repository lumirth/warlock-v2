import {
  isKnownRequirementCode,
  requirementFilter,
  REQUIREMENT_FILTER_MODES,
  type RequirementFilter,
  type RequirementFilterMode,
} from "./course.js";
import type { SearchCourseResultDto } from "./course.js";

export const SEARCH_SORT_FIELDS = [
  "relevance", "gpa", "quality", "instructor_difficulty",
  "instructor_rating", "level", "credits",
] as const;
export type SortField = (typeof SEARCH_SORT_FIELDS)[number];
export type SortDirection = "asc" | "desc";
export type SearchSort = { field: SortField; direction: SortDirection };
export const SEARCH_SORT_DEFAULT_DIRECTIONS: Record<SortField, SortDirection> = {
  relevance: "desc",
  gpa: "desc",
  quality: "desc",
  instructor_difficulty: "asc",
  instructor_rating: "desc",
  level: "asc",
  credits: "asc",
};
export const DEFAULT_SEARCH_SORT: SearchSort = { field: "relevance", direction: "desc" };

const SEARCH_SCOPE_VALUES = ["active", "all"] as const;
export type SearchScope = (typeof SEARCH_SCOPE_VALUES)[number];
export const SEARCH_TERM_VALUES = ["spring", "summer", "fall", "winter"] as const;
export type SearchTermFilter = (typeof SEARCH_TERM_VALUES)[number];
export const SEARCH_TIME_VALUES = ["early", "morning", "midday", "afternoon", "evening"] as const;
export type SearchTimeFilter = (typeof SEARCH_TIME_VALUES)[number];
export const SEARCH_STATUS_VALUES = ["open", "available", "closed"] as const;
export type SearchStatusFilter = (typeof SEARCH_STATUS_VALUES)[number];
export const SEARCH_INSTRUCTOR_DIFFICULTY_VALUES = ["lower", "higher"] as const;
export type SearchInstructorDifficultyFilter = (typeof SEARCH_INSTRUCTOR_DIFFICULTY_VALUES)[number];
export const SEARCH_LEVEL_VALUES = [100, 200, 300, 400, 500] as const;
export type SearchLevelFilter = (typeof SEARCH_LEVEL_VALUES)[number];
export const SEARCH_PAGINATION_DEFAULT_LIMIT = 20;
export const SEARCH_BROWSEABLE_RESULT_LIMIT = 400;
export const SEARCH_QUERY_MAX_LENGTH = 500;

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
  instructorDifficulty?: SearchInstructorDifficultyFilter;
  level?: SearchLevelFilter;
};
export type SearchRequestFilterKey = keyof SearchRequestFiltersDto;
export type AdvancedSearchStateDto = { filters: SearchRequestFiltersDto; scope?: SearchScope };
export type SearchRequestDto = {
  query: string;
  filters?: SearchRequestFiltersDto;
  sort?: SearchSort;
  scope?: SearchScope;
  pagination?: { limit?: number; offset?: number };
};
export type NormalizedSearchRequestDto = {
  query: string;
  filters: SearchRequestFiltersDto;
  sort: SearchSort;
  scope: SearchScope;
};
export type SearchRequestPaginationDto = { limit: number; offset: number };

type ScalarFilterKey = Exclude<SearchRequestFilterKey, "requirement">;
type Parser = (value: unknown) => unknown;
type Field = readonly [key: ScalarFilterKey, param: string, parse: Parser];
const missing = (value: unknown) => value === undefined || value === null || value === "";
const text = (
  name: string,
  options: { casing?: "upper" | "lower"; max?: number; pattern?: RegExp; description?: string } = {},
): Parser => (value) => {
  if (missing(value)) return undefined;
  if (typeof value !== "string") throw new TypeError(`${name} must be a string`);
  let result = value.trim();
  if (!result) return undefined;
  if (options.casing === "upper") result = result.toUpperCase();
  if (options.casing === "lower") result = result.toLowerCase();
  if (options.max && result.length > options.max) {
    throw new TypeError(`${name} must be ${options.max} characters or fewer`);
  }
  if (options.pattern && !options.pattern.test(result)) {
    throw new TypeError(`${name} must be ${options.description}`);
  }
  return result;
};
const integer = (
  name: string,
  min: number,
  max: number,
  allowed?: readonly number[],
): Parser => (value) => {
  if (missing(value)) return undefined;
  const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isInteger(parsed)) throw new TypeError(`${name} must be an integer`);
  if (allowed && !allowed.includes(parsed as number)) {
    throw new TypeError(`${name} must be one of: ${allowed.join(", ")}`);
  }
  if ((parsed as number) < min || (parsed as number) > max) {
    throw new TypeError(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
};
const enumeration = (name: string, values: readonly string[]): Parser => (value) => {
  if (missing(value)) return undefined;
  if (typeof value !== "string") throw new TypeError(`${name} must be a string`);
  const parsed = value.trim().toLowerCase();
  if (!values.includes(parsed)) throw new TypeError(`${name} must be one of: ${values.join(", ")}`);
  return parsed;
};
const boolean = (name: string): Parser => (value) => {
  if (missing(value)) return undefined;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new TypeError(`${name} must be a boolean`);
};

const FIELDS: readonly Field[] = [
  ["subject", "subject", text("subject", { casing: "upper", pattern: /^[A-Z]{2,4}$/, description: "a 2-4 letter subject code" })],
  ["number", "number", text("number", { casing: "upper", pattern: /^\d{3}[A-Z]?$/, description: "a 3 digit catalog number with optional suffix" })],
  ["instructor", "instructor", text("instructor", { max: 80 })],
  ["term", "term", enumeration("term", SEARCH_TERM_VALUES)],
  ["year", "year", integer("year", 2000, 2100)],
  ["credits", "credits", integer("credits", 0, 8)],
  ["days", "days", text("days", { casing: "upper", pattern: /^[MTWRFSU]{1,7}$/, description: "meeting-day letters like MWF or TR" })],
  ["time", "time", enumeration("time", SEARCH_TIME_VALUES)],
  ["partOfTerm", "partOfTerm", text("partOfTerm", { casing: "upper", pattern: /^[A-Z0-9]$/, description: "a single Course Explorer part-of-term code" })],
  ["online", "online", boolean("online")],
  ["status", "status", enumeration("status", SEARCH_STATUS_VALUES)],
  ["instructorDifficulty", "instructor_difficulty", enumeration("instructor_difficulty", SEARCH_INSTRUCTOR_DIFFICULTY_VALUES)],
  ["level", "level", integer("level", 100, 500, SEARCH_LEVEL_VALUES)],
];
export const SEARCH_QUERY_PARAM_NAMES = [
  "q", ...FIELDS.map(([, param]) => param), "requirement", "requirementMode",
  "scope", "sort", "direction", "limit", "offset",
];

const member = <T>(values: readonly T[], value: unknown): value is T => values.includes(value as T);
export const isSearchSortField = (value: unknown): value is SortField => member(SEARCH_SORT_FIELDS, value);
export const isSearchTermFilter = (value: unknown): value is SearchTermFilter => member(SEARCH_TERM_VALUES, value);
export const isSearchTimeFilter = (value: unknown): value is SearchTimeFilter => member(SEARCH_TIME_VALUES, value);
export const isSearchStatusFilter = (value: unknown): value is SearchStatusFilter => member(SEARCH_STATUS_VALUES, value);
export const isSearchInstructorDifficultyFilter = (
  value: unknown,
): value is SearchInstructorDifficultyFilter => member(SEARCH_INSTRUCTOR_DIFFICULTY_VALUES, value);
export const isSearchLevelFilter = (value: unknown): value is SearchLevelFilter => member(SEARCH_LEVEL_VALUES, value);
export const searchTermRank = (value: string): number =>
  ["winter", "spring", "summer", "fall"].indexOf(value.toLowerCase()) + 1;

function parseRequirement(value: unknown): RequirementFilter | undefined {
  if (!value) return undefined;
  if (typeof value !== "object") throw new TypeError("requirement must be an object");
  const { mode, codes } = value as Partial<RequirementFilter>;
  if (!member(REQUIREMENT_FILTER_MODES, mode)) {
    throw new TypeError(`requirement mode must be one of: ${REQUIREMENT_FILTER_MODES.join(", ")}`);
  }
  if (!Array.isArray(codes)) throw new TypeError("requirement codes must be an array");
  if (mode === "single" && codes.length !== 1) {
    throw new TypeError("single requirement filters must contain exactly one code");
  }
  for (const code of codes) {
    if (!isKnownRequirementCode(code)) throw new TypeError(`unknown requirement code: ${code}`);
  }
  return requirementFilter(mode, codes);
}

function filtersFrom(values: Partial<Record<SearchRequestFilterKey, unknown>>): SearchRequestFiltersDto {
  const filters: Record<string, unknown> = {};
  for (const [key, , parse] of FIELDS) {
    const value = parse(values[key]);
    if (value !== undefined) filters[key] = value;
  }
  const requirement = parseRequirement(values.requirement);
  if (requirement) filters.requirement = requirement;
  return filters as SearchRequestFiltersDto;
}

function normalizeSort(sort?: SearchSort, name = "sort field"): SearchSort {
  const field = normalizedSortField(sort?.field, name);
  return { field, direction: normalizedSortDirection(field, sort?.direction) };
}

function normalizedSortField(value: unknown, name: string): SortField {
  if (value === undefined) return "relevance";
  if (!isSearchSortField(value)) {
    throw new TypeError(`${name} must be one of: ${SEARCH_SORT_FIELDS.join(", ")}`);
  }
  return value;
}

function normalizedSortDirection(field: SortField, value: unknown): SortDirection {
  if (value !== undefined && !member(["asc", "desc"] as const, value)) {
    throw new TypeError("direction must be one of: asc, desc");
  }
  if (field === "relevance") return "desc";
  return value as SortDirection | undefined ?? SEARCH_SORT_DEFAULT_DIRECTIONS[field];
}

export function normalizeSearchRequestDto(request: SearchRequestDto): NormalizedSearchRequestDto {
  if (typeof request.query !== "string") throw new TypeError("query must be a string");
  if (request.query.length > SEARCH_QUERY_MAX_LENGTH) {
    throw new TypeError(`query must be ${SEARCH_QUERY_MAX_LENGTH} characters or fewer`);
  }
  if (request.scope !== undefined && !member(SEARCH_SCOPE_VALUES, request.scope)) {
    throw new TypeError(`scope must be one of: ${SEARCH_SCOPE_VALUES.join(", ")}`);
  }
  return {
    query: request.query,
    filters: filtersFrom(request.filters ?? {}),
    sort: normalizeSort(request.sort),
    scope: request.scope ?? "active",
  };
}

const bounded = (value: number, name: string, min: number, max: number): number => {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TypeError(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
};
export function normalizeSearchPaginationDto(
  pagination?: SearchRequestDto["pagination"],
): SearchRequestPaginationDto {
  const result = {
    limit: bounded(pagination?.limit ?? 20, "limit", 1, 50),
    offset: bounded(pagination?.offset ?? 0, "offset", 0, 399),
  };
  if (result.limit + result.offset > SEARCH_BROWSEABLE_RESULT_LIMIT) {
    throw new TypeError(`pagination window must not exceed ${SEARCH_BROWSEABLE_RESULT_LIMIT} results`);
  }
  return result;
}
export const searchRequestHasFilters = (
  request: Pick<NormalizedSearchRequestDto, "filters">,
): boolean => Object.values(request.filters).some((value) => value !== undefined);
export function splitAdvancedSearchState(state?: AdvancedSearchStateDto): AdvancedSearchStateDto {
  const normalized = normalizeSearchRequestDto({ query: "", ...state });
  return { filters: normalized.filters, ...(normalized.scope === "all" ? { scope: "all" as const } : {}) };
}

export function searchRequestToQueryEntries(request: SearchRequestDto): Array<[string, string]> {
  const normalized = normalizeSearchRequestDto(request);
  const entries: Array<[string, string]> = [["q", normalized.query]];
  if (request.pagination) {
    const page = normalizeSearchPaginationDto(request.pagination);
    if (request.pagination.limit !== undefined) entries.push(["limit", String(page.limit)]);
    if (request.pagination.offset !== undefined) entries.push(["offset", String(page.offset)]);
  }
  for (const [key, param] of FIELDS) {
    const value = normalized.filters[key];
    if (value !== undefined) entries.push([param, String(value)]);
  }
  const requirement = normalized.filters.requirement;
  if (requirement) {
    entries.push(["requirement", requirement.codes.join(",")]);
    if (requirement.mode !== "single") entries.push(["requirementMode", requirement.mode]);
  }
  if (normalized.scope === "all") entries.push(["scope", "all"]);
  if (normalized.sort.field !== "relevance") {
    entries.push(["sort", normalized.sort.field], ["direction", normalized.sort.direction]);
  }
  return entries;
}

type QueryReader = { get(name: string): string | null };
function urlNumber(reader: QueryReader, name: string, fallback: number, min: number, max: number): number {
  const raw = reader.get(name);
  if (raw === null || raw === "") return fallback;
  if (!/^-?\d+$/.test(raw)) throw new TypeError(`${name} must be an integer`);
  const value = Number(raw);
  if (value < min || value > max) throw new TypeError(`${name} must be between ${min} and ${max}`);
  return value;
}
export function decodeSearchRequestQuery(params: QueryReader) {
  try {
    const query = queryText(params);
    const request = normalizeSearchRequestDto({
      query,
      filters: queryFilters(params),
      sort: {
        field: queryValue(params, "sort") as SortField,
        direction: queryValue(params, "direction") as SortDirection,
      },
      scope: queryValue(params, "scope") as SearchScope,
    });
    if (!query.trim() && !searchRequestHasFilters(request)) {
      throw new TypeError("Missing query parameter q");
    }
    return { ok: true as const, value: { request, pagination: queryPage(params) } };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Invalid search request" };
  }
}

function queryText(params: QueryReader): string {
  const query = params.get("q") ?? "";
  if (query.length > SEARCH_QUERY_MAX_LENGTH) {
    throw new TypeError(`q must be ${SEARCH_QUERY_MAX_LENGTH} characters or fewer`);
  }
  return query;
}

function queryPage(params: QueryReader): SearchRequestPaginationDto {
  return normalizeSearchPaginationDto({
    limit: urlNumber(params, "limit", 20, 1, 50),
    offset: urlNumber(params, "offset", 0, 0, 399),
  });
}

function queryFilters(params: QueryReader): SearchRequestFiltersDto {
  const raw: Partial<Record<SearchRequestFilterKey, unknown>> = {};
  for (const [key, param] of FIELDS) raw[key] = params.get(param) ?? undefined;
  const requirement = queryRequirement(params);
  if (requirement) raw.requirement = requirement;
  return filtersFrom(raw);
}

function queryRequirement(params: QueryReader): RequirementFilter | undefined {
  const codes = (params.get("requirement") ?? "")
    .split(",").map(code => code.trim().toUpperCase()).filter(Boolean);
  if (!codes.length) return undefined;
  const rawMode = queryValue(params, "requirementMode");
  if (rawMode && !member(REQUIREMENT_FILTER_MODES, rawMode)) {
    throw new TypeError(`requirementMode must be one of: ${REQUIREMENT_FILTER_MODES.join(", ")}`);
  }
  const mode = (rawMode ?? (codes.length > 1 ? "all" : "single")) as RequirementFilterMode;
  if (mode === "single" && codes.length > 1) {
    throw new TypeError("requirement must contain one code when requirementMode is single");
  }
  return { mode, codes };
}

function queryValue(params: QueryReader, name: string): string | undefined {
  return params.get(name)?.trim().toLowerCase() || undefined;
}

export type SearchChipType =
  | "courseCode" | "crn" | "subject" | "instructor" | "days" | "time"
  | "level" | "levelBoost" | "credits" | "online" | "status"
  | "instructorDifficulty" | "requirement" | "term" | "partOfTerm"
  | "negation" | "topic";
export type SearchChipDto = {
  id: string;
  type: SearchChipType;
  label: string;
  removeRequest: SearchRequestDto;
};
export type SearchAmbiguityActionDto = {
  id: string;
  label: string;
  nextRequest: SearchRequestDto;
};
export type SearchMetaDto = {
  nextRequest: SearchRequestDto;
  interpretedRequest: SearchRequestDto;
  ui: { chips: SearchChipDto[]; ambiguityActions: SearchAmbiguityActionDto[] };
  retrieval?: { degraded: boolean };
};
export type SearchResponseDto = {
  results: SearchCourseResultDto[];
  meta: SearchMetaDto;
  pagination: {
    totalResults: number;
    browseableResults: number;
    limit: number;
    offset: number;
    hasMore?: boolean;
  };
};

export type TermStatus = "registrable" | "active" | "historical";
export type SearchTermOptionDto = {
  termId: string;
  term: SearchTermFilter;
  year: number;
  status: TermStatus;
  label: string;
};
export type SearchTermOptionsDto = { terms: SearchTermOptionDto[] };
