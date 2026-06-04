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
  type SearchPageWindow,
} from "./search-budget.js";
import {
  controlsWithPlanInferredSort,
  normalizeSearchControls,
} from "./search-controls.js";
import { executeSearchPlan } from "./search-executor.js";
import { buildRecoveryGroups } from "./search-recovery.js";
import {
  assembleSearchPipelineResult,
  type SearchPipelineResult,
} from "./search-response.js";
import {
  createSearchPlan,
  extractSearchPlanningInput,
} from "./search-plan-compiler.js";
import {
  deepFreeze,
  type CanonicalSearchRequest,
} from "./search-request.js";

export type { SearchPipelineResult } from "./search-response.js";

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
   * execution details live in retrieval-plan, executor, controls, and recovery modules.
   */
  async search(
    request: CanonicalSearchRequest,
    page: Partial<SearchPageWindow> = {},
    waitUntil?: WaitUntil,
  ): Promise<SearchPipelineResult> {
    const startTime = performance.now();
    const query = request.query;
    const controls = normalizeSearchControls({
      sort: request.sort,
      scope: request.scope,
    });
    const pageWindow: SearchPageWindow = {
      limit: page.limit ?? 20,
      offset: page.offset ?? 0,
    };

    let planning = await getCachedSearchPlan(
      this.searchCache,
      request,
    ).catch((error) => {
      logger.warn("search.cache.plan_get_failed", { ...errorFields(error) });
      return null;
    });
    if (!planning) {
      const planningInput = extractSearchPlanningInput(query);
      planning = await createSearchPlan(
        this.db,
        query,
        planningInput,
        request.filters,
      );
      enqueueCacheWrite(
        cacheSearchPlan(this.searchCache, request, planning),
        waitUntil,
        "search.cache.plan_put_failed",
      );
    }
    const extractionEndTime = performance.now();
    const { extraction, queryResidual, plan, compilerEvents } = deepFreeze(planning);
    const effectiveControls = controlsWithPlanInferredSort(controls, plan);
    const budget = buildSearchCandidateBudget(plan, pageWindow, effectiveControls);

    const cachedResult = await getCachedSearchResult(
      this.searchCache,
      request,
      budget.executionResultLimit,
    ).catch((error) => {
      logger.warn("search.cache.result_get_failed", { ...errorFields(error) });
      return null;
    });
    if (cachedResult) {
      return cachedResult;
    }

    const searchStartTime = performance.now();
    const execution = await executeSearchPlan(
      this.db,
      this.vectorize,
      this.ai,
      plan,
      pageWindow,
      effectiveControls,
      queryResidual,
      budget,
    );
    const recoveryGroups = buildRecoveryGroups(
      plan,
      request,
      execution.results.length,
    );
    const searchEndTime = performance.now();
    const totalEndTime = performance.now();
    const result = assembleSearchPipelineResult({
      rawQuery: query,
      queryResidual,
      extractionHints: extraction.hints,
      compilerEvents,
      plan,
      execution,
      recoveryGroups,
      appliedSort: effectiveControls.sort,
      appliedScope: effectiveControls.scope,
      timings: {
        extractionMs: extractionEndTime - startTime,
        searchMs: searchEndTime - searchStartTime,
        totalMs: totalEndTime - startTime,
      },
    });

    enqueueCacheWrite(
      cacheSearchResult(
        this.searchCache,
        request,
        budget.executionResultLimit,
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
