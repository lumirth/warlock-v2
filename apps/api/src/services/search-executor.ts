import type { Ai, D1Database, VectorizeIndex } from "@cloudflare/workers-types";
import type { SearchPlan } from "./search-planner-types.js";
import {
  buildSearchCandidateBudget,
  type SearchCandidateBudget,
  type SearchPageWindow,
} from "./search-budget.js";
import { applySearchControls, type AppliedSearchControls } from "./search-controls.js";
import { compareRankedSearchResults } from "./ranking/index.js";
import {
  buildRetrievalPlan,
  type RetrievalPlan,
} from "./search-retrieval-plan.js";
import { hybridSearchWithTermRanking } from "./search-term-ranking.js";
import type { SearchResult } from "./search-types.js";
import type { SearchFallbackPlan } from "./search-planning-types.js";

export type SearchExecutionResult = {
  results: SearchResult[];
  tierReached: number;
  constraintsRelaxed: string[];
  originalResultCount: number;
  budget: SearchCandidateBudget;
  retrievalPlan: RetrievalPlan;
  retrievalPlans: RetrievalPlan[];
};

export async function executeSearchPlan(
  db: D1Database,
  vectorize: VectorizeIndex,
  ai: Ai,
  plan: SearchPlan,
  page: SearchPageWindow,
  controls: AppliedSearchControls,
  fallbackPlans: readonly SearchFallbackPlan[],
  budget: SearchCandidateBudget = buildSearchCandidateBudget(plan, page, controls),
): Promise<SearchExecutionResult> {
  const retrievalPlan = buildRetrievalPlan(plan, controls, budget);
  const retrievalPlans = [retrievalPlan];
  const isNavigational = retrievalPlan.isNavigational;
  let tierReached = isNavigational ? 1 : 2;
  const constraintsRelaxed: string[] = [];

  let results = await hybridSearchWithTermRanking(
    db,
    vectorize,
    ai,
    retrievalPlan,
    plan,
  );
  const originalResultCount = results.length;

  if (!isNavigational && results.length < 3) {
    for (const fallback of fallbackPlans) {
      tierReached = 3;
      const expandedRetrievalPlan = buildRetrievalPlan(
        fallback.plan,
        controls,
        budget,
      );
      retrievalPlans.push(expandedRetrievalPlan);
      const expandedResults = await hybridSearchWithTermRanking(
        db,
        vectorize,
        ai,
        expandedRetrievalPlan,
        fallback.plan,
      );
      for (const constraint of fallback.constraintsRelaxed) {
        if (!constraintsRelaxed.includes(constraint)) {
          constraintsRelaxed.push(constraint);
        }
      }
      results = mergeResults(results, expandedResults, budget.executionResultLimit);
      if (results.length >= 3) {
        break;
      }
    }
  }

  const controlledResults = applySearchControls(results, controls, {
    hasExplicitTermFilter: Boolean(plan.filters.term || plan.filters.year),
  }).slice(0, budget.executionResultLimit);

  return {
    results: controlledResults,
    tierReached,
    constraintsRelaxed,
    originalResultCount,
    budget,
    retrievalPlan,
    retrievalPlans,
  };
}

function mergeResults(
  left: SearchResult[],
  right: SearchResult[],
  limit: number,
): SearchResult[] {
  const map = new Map<string, SearchResult>();

  for (const result of left) {
    map.set(result.course.id, result);
  }

  for (const result of right) {
    const existing = map.get(result.course.id);
    if (!existing || result.score > existing.score) {
      map.set(result.course.id, result);
    }
  }

  return Array.from(map.values())
    .sort(compareRankedSearchResults)
    .slice(0, limit);
}
