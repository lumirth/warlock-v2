import type { D1Database } from "@cloudflare/workers-types";
import {
  type SearchRequestFiltersDto,
} from "@uiuc-course-search/query-types";
import {
  deepFreeze,
} from "./search-request.js";
import {
  extractSearchPlanningInput,
} from "./search-plan-hints.js";
import {
  createPlanningContext,
  runPlanningPasses,
} from "./search-planning-passes.js";
import {
  type SearchPlanningInput,
  type SearchPlanningResult,
} from "./search-planning-types.js";

export { extractSearchPlanningInput } from "./search-plan-hints.js";
export {
  SEARCH_PLANNING_PASSES,
  type PlanningArtifact,
  type SearchPlanningPass,
} from "./search-planning-passes.js";
export type {
  SearchCompilerEvent,
  SearchCompilerEventStage,
  SearchPlanningInput,
  SearchPlanningResult,
} from "./search-planning-types.js";

export async function createSearchPlan(
  db: D1Database,
  query: string,
  input: SearchPlanningInput = extractSearchPlanningInput(query),
  requestFilters?: SearchRequestFiltersDto,
): Promise<SearchPlanningResult> {
  const context = await runPlanningPasses(
    createPlanningContext(db, query, input, requestFilters),
  );
  if (!context.plan) {
    throw new Error("Search planning completed without a plan");
  }

  return deepFreeze({
    extraction: context.planningInput.extraction,
    queryResidual: context.queryResidual,
    plan: context.plan,
    fallbackPlans: context.fallbackPlans,
    compilerEvents: context.compilerEvents,
  });
}
