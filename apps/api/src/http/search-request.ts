import {
  parseSearchRequestQueryParams,
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
  const parsed = parseSearchRequestQueryParams(params);
  if (!parsed.ok) return parsed;

  return {
    ok: true,
    value: {
      request: parsed.value.request,
      pagination: parsed.value.pagination,
    },
  };
}
