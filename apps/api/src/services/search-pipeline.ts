import type {
  D1Database,
  VectorizeIndex,
  Ai,
  KVNamespace,
} from "@cloudflare/workers-types";
import {
  cacheSearchPlan,
  cacheSearchResult,
  getCachedSearchPlan,
  getCachedSearchResult,
} from "./search-cache.js";
import { errorFields, logger } from "../observability/logger.js";
import {
  buildSearchCandidateBudget,
} from "./search-budget.js";
import {
  controlsWithPlanInferredSort,
  normalizeSearchControls,
} from "./search-controls.js";
import { executeSearchPlan } from "./search-executor.js";
import type { SearchPipelineResult } from "./search-pipeline-result.js";
import { createSearchPlan } from "./search-plan-compiler.js";
import type { NormalizedSearchRequestDto } from "@uiuc-course-search/query-types";

type WaitUntil = (promise: Promise<unknown>) => void;

export class SearchPipeline {
  constructor(
    private db: D1Database,
    private vectorize: VectorizeIndex,
    private ai: Ai,
    private searchCache?: KVNamespace,
  ) {}

  /**
   * Main search entry point. SearchPipeline owns planning/cache orchestration;
   * execution details live in retrieval-plan, executor, and controls modules.
   */
  async search(
    request: NormalizedSearchRequestDto,
    waitUntil?: WaitUntil,
  ): Promise<SearchPipelineResult> {
    const query = request.query;
    const cachedResult = await getCachedSearchResult(
      this.searchCache,
      request,
    ).catch((error) => {
      logger.warn("search.cache.result_get_failed", { ...errorFields(error) });
      return null;
    });
    if (cachedResult) {
      return cachedResult;
    }

    const controls = normalizeSearchControls({
      sort: request.sort,
      scope: request.scope,
    });
    let planning = await getCachedSearchPlan(
      this.searchCache,
      request,
    ).catch((error) => {
      logger.warn("search.cache.plan_get_failed", { ...errorFields(error) });
      return null;
    });
    if (!planning) {
      planning = await createSearchPlan(
        this.db,
        query,
        request.filters,
      );
      enqueueCacheWrite(
        cacheSearchPlan(this.searchCache, request, planning),
        waitUntil,
        "search.cache.plan_put_failed",
      );
    }
    const { extraction, queryResidual, plan, compilerEvents } = planning;
    const effectiveControls = controlsWithPlanInferredSort(controls, plan);
    const budget = buildSearchCandidateBudget();

    const execution = await executeSearchPlan(
      this.db,
      this.vectorize,
      this.ai,
      plan,
      effectiveControls,
      budget,
    );
    const result: SearchPipelineResult = {
      results: execution.results,
      totalResults: execution.totalResults,
      meta: {
        query: {
          raw: query,
          residual: queryResidual,
        },
        extraction: {
          hints: extraction.hints,
        },
        compilerEvents,
        plan,
        retrievalPlan: execution.retrievalPlan,
      },
    };

    enqueueCacheWrite(
      cacheSearchResult(
        this.searchCache,
        request,
        result,
      ),
      waitUntil,
      "search.cache.result_put_failed",
    );

    return result;
  }
}

function enqueueCacheWrite(
  promise: Promise<void>,
  waitUntil: ((promise: Promise<unknown>) => void) | undefined,
  failureEvent: string,
): void {
  const guarded = promise.catch((error) => {
    logger.warn(failureEvent, { ...errorFields(error) });
  });

  if (waitUntil) {
    waitUntil(guarded);
  } else {
    void guarded;
  }
}
