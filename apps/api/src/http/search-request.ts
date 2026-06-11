import {
  decodeSearchRequestQuery,
  type NormalizedSearchRequestDto,
  type SearchRequestPaginationDto,
} from "@uiuc-course-search/query-types";
import type { ParsedParam } from "./params.js";

type ParsedSearchHttpRequest = Readonly<{
  request: NormalizedSearchRequestDto;
  pagination: SearchRequestPaginationDto;
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
