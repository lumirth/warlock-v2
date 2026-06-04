import type { Ai, D1Database, VectorizeIndex } from "@cloudflare/workers-types";
import { hybridSearch } from "./search-hybrid.js";
import type { RetrievalPlan } from "./search-retrieval-plan.js";
import type { SearchResult } from "./search-types.js";
import { applySearchIntentBoosts } from "./search-usefulness.js";

export interface TermInfo {
  term_id: string;
  year: number;
  term: string;
  status: string;
}

export function buildTermPriorityMap(termStates: TermInfo[]): Map<string, number> {
  const sorted = [...termStates].sort((left, right) => {
    const statusRank = (status: string): number => status === "registrable" ? 0 : status === "active" ? 1 : 2;
    const statusDelta = statusRank(left.status) - statusRank(right.status);
    if (statusDelta !== 0) return statusDelta;
    if (left.year !== right.year) return right.year - left.year;
    const regularTermDelta = regularTermRank(left.term) - regularTermRank(right.term);
    if (regularTermDelta !== 0) return regularTermDelta;
    return termChronology(right.year, right.term) - termChronology(left.year, left.term);
  });

  return new Map(sorted.map((term, index) => [term.term_id, index]));
}

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

  const priorityByTermId = buildTermPriorityMap(termStates.results);
  const currentTermIds = new Set(termStates.results.map(term => term.term_id));
  const results = await hybridSearch(db, vectorize, ai, retrievalPlan);

  const enrichedResults = applySearchIntentBoosts(results.map((result) => {
    const termInfo: TermInfo = {
      term_id: `${result.course.year}-${result.course.term}`,
      year: result.course.year,
      term: result.course.term,
      status: "historical",
    };
    const termPriority = getTermPriority(termInfo, priorityByTermId);
    return {
      ...result,
      termPriority,
      historical: !currentTermIds.has(termInfo.term_id),
    };
  }), retrievalPlan.effectivePlan);

  enrichedResults.sort((left, right) => {
    if (left.termPriority !== right.termPriority) {
      return left.termPriority! - right.termPriority!;
    }
    return right.score - left.score;
  });

  return enrichedResults.slice(0, retrievalPlan.budget.executionResultLimit);
}

function getTermPriority(
  termInfo: TermInfo,
  priorityByTermId: Map<string, number>,
): number {
  const knownPriority = priorityByTermId.get(termInfo.term_id);
  if (knownPriority !== undefined) return knownPriority;

  return 10_000 - termChronology(termInfo.year, termInfo.term);
}

function termChronology(year: number, term: string): number {
  const termRank: Record<string, number> = {
    winter: 1,
    spring: 2,
    summer: 3,
    fall: 4,
  };
  return year * 4 + (termRank[term.toLowerCase()] ?? 0);
}

function regularTermRank(term: string): number {
  return term === "fall" || term === "spring" ? 0 : 1;
}
