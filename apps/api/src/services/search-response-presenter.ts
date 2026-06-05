import type { D1Database } from "@cloudflare/workers-types";
import type {
  SearchInterpretationDto,
  NormalizedSearchRequestDto,
  SearchResponseDto,
} from "@uiuc-course-search/query-types";
import { coerceSearchRequestDto } from "@uiuc-course-search/query-types";
import { searchResultToCourseDto } from "../dto/course.js";
import { loadSearchResultRequirements } from "../dto/search-requirements.js";
import type { SearchRequestPagination } from "../http/search-request.js";
import { getSearchTermSummary } from "./term-state.js";
import type { SearchPipelineResult } from "./search-response.js";
import type { SearchPlan } from "./search-planner-types.js";
import {
  buildInterpretedSearchRequest,
  buildSearchUiPlan,
} from "./search-ui-plan.js";

export async function presentSearchResponse(input: {
  db: D1Database;
  request: NormalizedSearchRequestDto;
  pagination: SearchRequestPagination;
  result: SearchPipelineResult;
}): Promise<SearchResponseDto> {
  const { db, request, pagination, result } = input;
  const { limit, offset } = pagination;
  const pageResults = result.results.slice(offset, offset + limit);
  const hasMore = result.results.length > offset + limit;
  const appliedSort = result.meta.appliedSort ?? request.sort;
  const appliedScope = result.meta.appliedScope ?? request.scope;
  const effectiveRequest: NormalizedSearchRequestDto = {
    ...request,
    sort: appliedSort,
    scope: appliedScope,
  };
  const nextRequest = coerceSearchRequestDto(effectiveRequest);
  const interpretedRequest = buildInterpretedSearchRequest(
    result.meta.extraction.hints,
    result.meta.plan,
    result.meta.query.residual,
    effectiveRequest,
  );
  const normalizedInterpretedRequest = coerceSearchRequestDto(interpretedRequest);
  const [requirementsByCourseId, term] = await Promise.all([
    loadSearchResultRequirements(
      db,
      pageResults.map((searchResult) => searchResult.course.id),
    ),
    getSearchTermSummary(db),
  ]);
  const ui = buildSearchUiPlan(
    result.meta.extraction.hints,
    result.meta.plan,
    result.meta.query.residual,
    normalizedInterpretedRequest,
  );

  return {
    results: pageResults.map((searchResult) =>
      searchResultToCourseDto(searchResult, {
        plan: result.meta.plan,
        rawQuery: result.meta.query.raw,
        hints: result.meta.extraction.hints,
        requirements: requirementsByCourseId.get(searchResult.course.id) ?? [],
      }),
    ),
    meta: {
      query: result.meta.query,
      interpretation: searchPlanToPublicInterpretation(result.meta.plan),
      timing: result.meta.timing,
      fallback: result.meta.fallback,
      appliedSort,
      appliedScope,
      nextRequest,
      interpretedRequest,
      term,
      ui,
    },
    pagination: {
      resultCountLowerBound: offset + pageResults.length + (hasMore ? 1 : 0),
      limit,
      offset,
      hasMore,
      nextOffset: hasMore ? offset + limit : null,
    },
  };
}

function searchPlanToPublicInterpretation(
  plan: SearchPlan,
): SearchInterpretationDto | undefined {
  return plan.rescue
    ? {
        queryTypes: plan.rescue.queryTypes,
        negativeTerms: plan.rescue.negativeTerms,
        topicTerms: plan.rescue.topicTerms,
        expandedTerms: plan.rescue.expandedTerms,
        assumptions: plan.rescue.assumptions,
        warnings: plan.rescue.warnings,
        evidenceLanes: plan.rescue.interpretedLanes,
        relaxationPlan: plan.rescue.relaxationPlan,
        needsStudentProfile: plan.rescue.needsStudentProfile,
        confidence: plan.rescue.confidence,
      }
    : undefined;
}
