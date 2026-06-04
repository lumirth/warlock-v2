import type { Ai, D1Database, VectorizeIndex } from "@cloudflare/workers-types";
import type { SearchPlan } from "@uiuc-course-search/query-types/search-planner";
import {
  buildSearchCandidateBudget,
  type SearchCandidateBudget,
  type SearchPageWindow,
} from "./search-budget.js";
import { applySearchControls, type AppliedSearchControls } from "./search-controls.js";
import {
  buildRetrievalPlan,
  type RetrievalPlan,
} from "./search-retrieval-plan.js";
import { hybridSearchWithTermRanking } from "./search-term-ranking.js";
import { sanitizeFtsQuery } from "./search-text.js";
import type { SearchResult } from "./search-types.js";
import { expandTopics } from "./topic-registry.js";

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
  queryResidual: string,
  budget: SearchCandidateBudget = buildSearchCandidateBudget(plan, page, controls),
): Promise<SearchExecutionResult> {
  const retrievalPlan = await buildRetrievalPlan(db, plan, controls, budget);
  const retrievalPlans = [retrievalPlan];
  const isNavigational = retrievalPlan.isNavigational;
  let tierReached = isNavigational ? 1 : 2;
  const constraintsRelaxed: string[] = [];

  let results = await hybridSearchWithTermRanking(
    db,
    vectorize,
    ai,
    retrievalPlan,
  );
  const originalResultCount = results.length;

  if (!isNavigational && results.length < 3) {
    const expandedPlan = expansionPlan(plan, queryResidual);
    if (expandedPlan) {
      tierReached = 3;
      const expandedRetrievalPlan = await buildRetrievalPlan(
        db,
        expandedPlan,
        controls,
        budget,
      );
      retrievalPlans.push(expandedRetrievalPlan);
      const expandedResults = await hybridSearchWithTermRanking(
        db,
        vectorize,
        ai,
        expandedRetrievalPlan,
      );
      results = mergeResults(results, expandedResults, budget.executionResultLimit);
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

function expansionPlan(plan: SearchPlan, queryResidual: string): SearchPlan | null {
  const existingExpansions = Array.isArray(plan.softPreferences?.topicExpansions)
    ? plan.softPreferences.topicExpansions
    : [];
  const expandedKeywords =
    existingExpansions.length > 0 ? [] : expandTopics(queryResidual);
  if (expandedKeywords.length === 0) {
    return null;
  }

  return {
    ...plan,
    keywordQuery: sanitizeFtsQuery(
      `${plan.keywordQuery} ${expandedKeywords.join(" ")}`,
    ),
    semanticQuery: sanitizeFtsQuery(
      `${plan.semanticQuery} ${expandedKeywords.join(" ")}`,
    ),
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
    .sort((a, b) => {
      if (a.termPriority !== b.termPriority) {
        return (a.termPriority ?? 100) - (b.termPriority ?? 100);
      }
      return b.score - a.score;
    })
    .slice(0, limit);
}
