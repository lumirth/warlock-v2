import type { Ai, D1Database, VectorizeIndex } from "@cloudflare/workers-types";
import { hybridSearch } from "./search-hybrid.js";
import {
  applyTermRankingPolicy,
  buildTermPriorityMap,
  type RankingTermInfo,
} from "./ranking/index.js";
import type { RetrievalPlan } from "./search-retrieval-plan.js";
import type { SearchResult } from "./search-types.js";

export type TermInfo = RankingTermInfo;
export { buildTermPriorityMap };

export async function hybridSearchWithTermRanking(
  db: D1Database,
  vectorize: VectorizeIndex,
  ai: Ai,
  retrievalPlan: RetrievalPlan,
): Promise<SearchResult[]> {
  const termStates = await db.prepare(`
    SELECT term_id, year, term, status FROM term_state
    WHERE status IN ('active', 'registrable')
  `).all<TermInfo>();

  const results = await hybridSearch(db, vectorize, ai, retrievalPlan);
  return applyTermRankingPolicy(results, {
    termStates: termStates.results,
    limit: retrievalPlan.budget.executionResultLimit,
  });
}
