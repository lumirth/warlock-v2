import {
  decodeSearchRequestQuery,
  type SearchRequestPaginationDto,
} from "@uiuc-course-search/query-types";
import type { CanonicalSearchRequest } from "../services/search-request.js";
import type { ParsedParam } from "./params.js";

export type SearchRequestPagination = SearchRequestPaginationDto;

export type ParsedSearchHttpRequest = Readonly<{
  request: CanonicalSearchRequest;
  pagination: SearchRequestPagination;
}>;

export function parseSearchHttpRequest(
  params: URLSearchParams,
): ParsedParam<ParsedSearchHttpRequest> {
  const decoded = decodeSearchRequestQuery(params);
  if (!decoded.ok) {
    return decoded;
  }
  return {
    ok: true,
    value: decoded.value,
  };
}
