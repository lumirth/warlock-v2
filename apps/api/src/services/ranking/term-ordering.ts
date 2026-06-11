import type { SearchResult } from "../search-types.js";
import { appendScoreComponents, scoreComponent } from "./score-utils.js";

export interface RankingTermInfo {
  term_id: string;
  year: number;
  term: string;
  status: string;
}

export function applyTermRankingPolicy(
  results: SearchResult[],
  context: {
    termStates: RankingTermInfo[];
    limit: number;
  },
): SearchResult[] {
  const priorityByTermId = buildTermPriorityMap(context.termStates);
  const currentTermIds = new Set(context.termStates.map(term => term.term_id));

  const enrichedResults = results.map((result) => {
    const termInfo: RankingTermInfo = {
      term_id: `${result.course.year}-${result.course.term}`,
      year: result.course.year,
      term: result.course.term,
      status: "historical",
    };
    const termPriority = getTermPriority(termInfo, priorityByTermId);
    const historical = !currentTermIds.has(termInfo.term_id);
    const termComponent = scoreComponent(
      "term_tie_breaker",
      0,
      historical
        ? `Historical ${result.course.term} ${result.course.year} result is ordered after current terms.`
        : `Current ${result.course.term} ${result.course.year} term priority ${termPriority}.`,
      [`term priority ${termPriority}`],
    );

    return {
      ...result,
      termPriority,
      historical,
      scoreComponents: appendScoreComponents(result.scoreComponents, [termComponent]),
    };
  });

  enrichedResults.sort(compareRankedSearchResults);

  return enrichedResults.slice(0, context.limit);
}

function compareRankedSearchResults(
  left: SearchResult,
  right: SearchResult,
): number {
  if (left.termPriority !== right.termPriority) {
    return (left.termPriority ?? 100) - (right.termPriority ?? 100);
  }
  return right.score - left.score;
}

export function buildTermPriorityMap(termStates: RankingTermInfo[]): Map<string, number> {
  const sorted = [...termStates].sort((left, right) => {
    const statusDelta = termStatusRank(left.status) - termStatusRank(right.status);
    if (statusDelta !== 0) return statusDelta;
    if (left.year !== right.year) return right.year - left.year;
    const regularTermDelta = regularTermRank(left.term) - regularTermRank(right.term);
    if (regularTermDelta !== 0) return regularTermDelta;
    return termChronology(right.year, right.term) - termChronology(left.year, left.term);
  });

  return new Map(sorted.map((term, index) => [term.term_id, index]));
}

function getTermPriority(
  termInfo: RankingTermInfo,
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

function termStatusRank(status: string): number {
  if (status === "registrable") return 0;
  if (status === "active") return 1;
  return 2;
}
