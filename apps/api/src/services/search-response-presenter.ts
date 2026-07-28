import type {
  NormalizedSearchRequestDto,
  SearchRequestPaginationDto,
  SearchResponseDto,
} from "@uiuc-course-search/query-types";
import { normalizeSearchRequestDto } from "@uiuc-course-search/query-types";
import type { SearchPipelineResult } from "./search-pipeline-result.js";
import {
  buildSearchUiPlan,
} from "./search-ui-plan.js";
import { buildInterpretedSearchRequest } from "./search-interpreted-request.js";
import { presentSearchCourseResult } from "./search-result-presentation.js";

export function presentSearchResponse(input: {
  request: NormalizedSearchRequestDto;
  pagination: SearchRequestPaginationDto;
  result: SearchPipelineResult;
}): SearchResponseDto {
  const { request, pagination, result } = input;
  const { limit, offset } = pagination;
  const pageResults = result.results.slice(offset, offset + limit);
  const hasMore = result.results.length > offset + limit;
  const appliedSort = result.meta.retrievalPlan.controls.sort;
  const appliedScope = result.meta.retrievalPlan.controls.scope;
  const effectiveRequest: NormalizedSearchRequestDto = {
    ...request,
    sort: appliedSort,
    scope: appliedScope,
  };
  const nextRequest = normalizeSearchRequestDto(effectiveRequest);
  const interpretedRequest = buildInterpretedSearchRequest(
    result.meta.extraction.hints,
    result.meta.plan,
    result.meta.query.residual,
    effectiveRequest,
  );
  const normalizedInterpretedRequest = normalizeSearchRequestDto(interpretedRequest);
  const retrievalDegraded =
    result.meta.retrievalExecution.failedLanes.length > 0;
  const sortLimitedToRetrievedWindow =
    appliedSort.field !== "relevance"
    && result.meta.retrievalExecution.successfulLanes.includes("topic_semantic")
    && result.results.some((searchResult) =>
      searchResult.laneMatches?.includes("topic_semantic"),
    );
  const ui = buildSearchUiPlan(
    result.meta.extraction.hints,
    result.meta.plan,
    result.meta.query.residual,
    {
      executableRequest: nextRequest,
      interpretedRequest: normalizedInterpretedRequest,
    },
  );

  return {
    results: pageResults.map((searchResult) =>
      presentSearchCourseResult(searchResult, {
        plan: result.meta.plan,
        rawQuery: result.meta.query.raw,
        hints: result.meta.extraction.hints,
      }),
    ),
    meta: {
      nextRequest,
      interpretedRequest,
      ui,
      retrieval: {
        degraded: retrievalDegraded,
        ...(sortLimitedToRetrievedWindow
          ? { sortLimitedToRetrievedWindow: true }
          : {}),
      },
    },
    pagination: {
      totalResults: result.totalResults,
      countIsComplete: !retrievalDegraded,
      browseableResults: result.results.length,
      limit,
      offset,
      hasMore,
      nextOffset: hasMore ? offset + limit : null,
      ...(result.meta.candidateWindow
        ? { candidateWindow: result.meta.candidateWindow }
        : {}),
    },
  };
}
