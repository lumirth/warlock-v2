import type { Ai, D1Database, VectorizeIndex } from "@cloudflare/workers-types";
import type { SearchPlan } from "./search-planner-types.js";
import {
  buildSearchCandidateBudget,
  type SearchCandidateBudget,
} from "./search-budget.js";
import type { AppliedSearchControls } from "./search-controls.js";
import {
  buildRetrievalPlan,
  type RetrievalPlan,
} from "./search-retrieval-plan.js";
import { hybridSearch } from "./search-hybrid.js";
import { applyFinalOrderingControls } from "./ranking/final-ordering.js";
import { applyTermRankingPolicy } from "./ranking/term-ordering.js";
import type { SearchResult } from "./search-types.js";
import { getCurrentTermStates } from "./term-state.js";
import {
  summarizeRetrievalExecution,
  type RetrievalExecutionSummary,
} from "./search-retrieval-lane-executors.js";

type SearchExecutionResult = {
  results: SearchResult[];
  totalResults: number;
  retrievalPlan: RetrievalPlan;
  retrievalExecution: RetrievalExecutionSummary;
};

export async function executeSearchPlan(
  db: D1Database,
  vectorize: VectorizeIndex,
  ai: Ai,
  plan: SearchPlan,
  controls: AppliedSearchControls,
  budget: SearchCandidateBudget = buildSearchCandidateBudget(),
): Promise<SearchExecutionResult> {
  const currentTermStates = await getCurrentTermStates(db);
  const retrievalPlan = buildRetrievalPlan(
    plan,
    controls,
    budget,
    currentTermStates.map((term) => term.term_id),
  );
  const retrieval = await hybridSearch(
    db,
    vectorize,
    ai,
    retrievalPlan,
    plan,
  );
  const results = applyTermRankingPolicy(retrieval.results, {
    termStates: currentTermStates,
    limit: budget.browseableResultLimit,
  });

  const controlledResults = applyFinalOrderingControls(results, controls, {
    hasExplicitTermFilter: Boolean(plan.filters.term || plan.filters.year),
  }).slice(0, budget.browseableResultLimit);

  return {
    results: controlledResults,
    totalResults: retrieval.totalResults,
    retrievalPlan,
    retrievalExecution: summarizeRetrievalExecution(retrieval.retrievalExecution),
  };
}
