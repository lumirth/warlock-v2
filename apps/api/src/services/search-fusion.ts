import type { RetrievalLane } from "./search-planner-types.js";
import type { RetrievalLaneResult } from "./search-types.js";
import { RANKING_POLICY } from "./ranking/ranking-policy.js";
import type {
  RankedLaneRow,
  WorkloadLaneRow,
} from "./search-retrieval-lane-result.js";
export type {
  RankedLaneRow,
  WorkloadLaneRow,
} from "./search-retrieval-lane-result.js";

export interface FusedSearchScore {
  id: string;
  score: number;
  semanticRank?: number;
  keywordRank?: number;
  laneMatches: RetrievalLane[];
  laneRanks: Partial<Record<RetrievalLane, number>>;
  laneResults: RetrievalLaneResult[];
  supportedSubjectiveClaims: string[];
}

export interface RetrievalLaneResults {
  laneResults: RetrievalLaneResult[];
}

export function fuseRetrievalResults(lanes: RetrievalLaneResults): FusedSearchScore[] {
  const laneRanks = new Map<string, Partial<Record<RetrievalLane, number>>>();
  const laneEvidence = new Map<string, RetrievalLaneResult[]>();
  const supportedClaims = new Map<string, Set<string>>();

  const addLaneRanks = (rows: RankedLaneRow[]): void => {
    rows.forEach((row, index) => {
      const rank = row.rank ?? index + 1;
      const lane = row.lane;
      const ranks = laneRanks.get(row.id) ?? {};
      const existing = ranks[lane];
      if (!existing || rank < existing) {
        ranks[lane] = rank;
      }
      laneRanks.set(row.id, ranks);
      const existingEvidence = laneEvidence.get(row.id) ?? [];
      existingEvidence.push({ ...row, rank });
      laneEvidence.set(row.id, existingEvidence);
    });
  };

  addLaneRanks(lanes.laneResults);
  for (const row of lanes.laneResults.filter(isWorkloadLaneRow)) {
    supportedClaims.set(row.id, new Set(row.claims));
  }

  const scores: FusedSearchScore[] = [];
  for (const id of laneRanks.keys()) {
    let score = 0;
    const ranks = laneRanks.get(id) ?? {};
    const semanticRank = ranks.topic_semantic;
    const keywordRank = bestKeywordLikeRank(ranks);

    for (const [lane, rank] of Object.entries(ranks) as [RetrievalLane, number][]) {
      score += laneRrfScore(lane, rank);
    }

    scores.push({
      id,
      score,
      semanticRank,
      keywordRank,
      laneMatches: Object.keys(ranks) as RetrievalLane[],
      laneRanks: ranks,
      laneResults: laneEvidence.get(id) ?? [],
      supportedSubjectiveClaims: Array.from(supportedClaims.get(id) ?? []),
    });
  }

  return scores.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    const aHasKeyword = a.keywordRank !== undefined;
    const bHasKeyword = b.keywordRank !== undefined;
    if (aHasKeyword !== bHasKeyword) {
      return aHasKeyword ? -1 : 1;
    }
    if (aHasKeyword && bHasKeyword) {
      return (a.keywordRank ?? 0) - (b.keywordRank ?? 0);
    }
    return 0;
  });
}

function isWorkloadLaneRow(row: RetrievalLaneResult): row is WorkloadLaneRow {
  return row.lane === "workload_evidence" && Array.isArray(row.claims);
}

function laneRrfScore(lane: RetrievalLane, rank: number): number {
  return RANKING_POLICY.retrievalFusion.laneWeights[lane]
    / (RANKING_POLICY.retrievalFusion.rrfK + rank);
}

function bestKeywordLikeRank(
  ranks: Partial<Record<RetrievalLane, number>>,
): number | undefined {
  const keywordRanks = [
    ranks.exact,
    ranks.official_text,
    ranks.requirement,
    ranks.section_text,
    ranks.structured_section,
    ranks.student_language_alias,
    ranks.workload_evidence,
  ].filter((rank): rank is number => typeof rank === "number");

  return keywordRanks.length > 0 ? Math.min(...keywordRanks) : undefined;
}
