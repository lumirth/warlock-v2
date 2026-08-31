import type { D1Database } from "@cloudflare/workers-types";
import type { NormalizedSearchRequestDto } from "@uiuc-course-search/query-types";
import { executeSearch } from "./search-engine.js";
import { createSearchPlan } from "./search-plan-compiler.js";
import type { SearchPipelineResult } from "./search-types.js";

export async function search(
  db: D1Database,
  request: NormalizedSearchRequestDto,
): Promise<SearchPipelineResult> {
  const planning = await createSearchPlan(db, request.query, request.filters);
  const execution = await executeSearch(db, planning.plan, {
    sort: request.sort,
    scope: request.scope,
  });
  return {
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
}
