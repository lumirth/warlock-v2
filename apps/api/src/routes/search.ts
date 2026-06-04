import { Hono } from "hono";
import type {
  D1Database,
  VectorizeIndex,
  Ai,
  KVNamespace,
} from "@cloudflare/workers-types";
import { SearchPipeline } from "../services/search-pipeline.js";
import {
  type SearchInterpretationDto,
  type SearchResponseDto,
} from "@uiuc-course-search/query-types";
import type { SearchPlan } from "../services/search-planner-types.js";
import { searchResultToCourseDto } from "../dto/course.js";
import { loadSearchResultGeneds } from "../dto/search-geneds.js";
import { buildSearchUiPlan } from "../services/search-ui-plan.js";
import { parseSearchHttpRequest } from "../http/search-request.js";
import { getSearchTermSummary } from "../services/term-state.js";
import { errorFields, logger } from "../observability/logger.js";

type Bindings = {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  SEARCH_CACHE?: KVNamespace;
  CURRENT_YEAR: string;
  CURRENT_TERM: string;
};

export const searchRoutes = new Hono<{ Bindings: Bindings }>();

// Hybrid search endpoint (combines semantic + keyword with RRF)
searchRoutes.get("/api/search", async (c) => {
  const searchParams = new URL(c.req.url).searchParams;
  const parsedRequest = parseSearchHttpRequest(searchParams);
  if (!parsedRequest.ok) {
    return c.json({ error: parsedRequest.error }, 400);
  }
  const { request, pagination } = parsedRequest.value;
  const { limit, offset } = pagination;

  try {
    const pipeline = new SearchPipeline(
      c.env.DB,
      c.env.VECTORIZE,
      c.env.AI,
      c.env.SEARCH_CACHE,
    );
    const result = await pipeline.search(
      request,
      pagination,
      c.executionCtx.waitUntil.bind(c.executionCtx),
    );
    const pageResults = result.results.slice(offset, offset + limit);
    const hasMore = result.results.length > offset + limit;
    const genedsByCourseId = await loadSearchResultGeneds(
      c.env.DB,
      pageResults.map((searchResult) => searchResult.course.id),
    );

    const ui = buildSearchUiPlan(
      result.meta.extraction.hints,
      result.meta.plan,
      result.meta.query.residual,
      request,
    );
    if (request.scope === "all") {
      ui.advanced.scope = request.scope;
    }
    const appliedSort = result.meta.appliedSort ?? request.sort;
    const appliedScope = result.meta.appliedScope ?? request.scope;

    const response: SearchResponseDto = {
      results: pageResults.map((searchResult) =>
        searchResultToCourseDto(searchResult, {
            plan: result.meta.plan,
            rawQuery: result.meta.query.raw,
            hints: result.meta.extraction.hints,
            geneds: genedsByCourseId.get(searchResult.course.id) ?? [],
          }),
      ),
      meta: {
        query: result.meta.query,
        interpretation: searchPlanToPublicInterpretation(result.meta.plan),
        timing: result.meta.timing,
        fallback: result.meta.fallback,
        appliedSort,
        appliedScope,
        term: await getSearchTermSummary(c.env.DB),
        ui,
      },
      pagination: {
        total: offset + pageResults.length + (hasMore ? 1 : 0),
        limit,
        offset,
        hasMore,
        nextOffset: hasMore ? offset + limit : null,
      },
    };

    return c.json(response);
  } catch (error) {
    logger.error("route.search.failed", { ...errorFields(error) });
    return c.json({ error: "Search failed" }, 500);
  }
});

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
        retrievalLanes: plan.rescue.interpretedLanes,
        relaxationPlan: plan.rescue.relaxationPlan,
        needsStudentProfile: plan.rescue.needsStudentProfile,
        confidence: plan.rescue.confidence,
      }
    : undefined;
}
