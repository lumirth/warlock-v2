import type { Ai, D1Database, KVNamespace, VectorizeIndex } from "@cloudflare/workers-types";
import type { NormalizedSearchRequestDto } from "@uiuc-course-search/query-types";
import { errorFields, logger } from "../observability/logger.js";
import { cacheSearchResult, getCachedSearchResult } from "./search-cache.js";
import { executeSearch } from "./search-engine.js";
import { createSearchPlan } from "./search-plan-compiler.js";
import type { SearchPipelineResult } from "./search-types.js";

export class SearchPipeline {
  constructor(
    private db: D1Database,
    private vectorize: VectorizeIndex,
    private ai: Ai,
    private cache?: KVNamespace,
  ) {}

  async search(
    request: NormalizedSearchRequestDto,
    waitUntil?: (promise: Promise<unknown>) => void,
  ): Promise<SearchPipelineResult> {
    const cached = await getCachedSearchResult(this.cache, request).catch(() => null);
    if (cached) return cached;

    const planning = await createSearchPlan(this.db, request.query, request.filters);
    const execution = await executeSearch(this.db, this.vectorize, this.ai, planning.plan, {
      sort: request.sort,
      scope: request.scope,
    });
    const result: SearchPipelineResult = {
      results: execution.results,
      totalResults: execution.totalResults,
      meta: {
        query: { residual: planning.residual },
        hints: planning.hints,
        plan: planning.plan,
        controls: execution.controls,
        lanes: execution.lanes,
        failedLanes: execution.failedLanes,
      },
    };
    const write = cacheSearchResult(this.cache, request, result).catch(error => {
      logger.warn("search.cache.put_failed", { ...errorFields(error) });
    });
    if (waitUntil) waitUntil(write);
    else void write;
    return result;
  }
}
