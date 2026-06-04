import type { RetrievalLane } from "@uiuc-course-search/query-types/search-planner";
import {
  COURSE_USEFULNESS_POLICY,
  getQualityTierRank,
} from "@uiuc-course-search/query-types";

export type RankedLaneRow = { id: string; rank: number };
export type WorkloadLaneRow = RankedLaneRow & { claims: string[] };

export interface FusedSearchScore {
  id: string;
  score: number;
  semanticRank?: number;
  keywordRank?: number;
  laneMatches: RetrievalLane[];
  laneRanks: Partial<Record<RetrievalLane, number>>;
  supportedSubjectiveClaims: string[];
}

export interface RetrievalLaneResults {
  isNavigational: boolean;
  courseKeywordResults: RankedLaneRow[];
  sectionKeywordResults: RankedLaneRow[];
  requirementResults: RankedLaneRow[];
  structuredSectionResults: RankedLaneRow[];
  aliasResults: RankedLaneRow[];
  semanticResults: { id: string; score: number }[];
  workloadResults: WorkloadLaneRow[];
}

const RRF_K = 60;

const LANE_WEIGHTS: Record<RetrievalLane, number> = {
  exact: 9,
  official_text: 1.8,
  requirement: 2.4,
  section_text: 1.6,
  structured_section: 2,
  student_language_alias: 2.1,
  topic_semantic: 1.4,
  workload_evidence: 2.2,
  help_path: 1,
};

export function fuseRetrievalResults(
  lanes: RetrievalLaneResults,
  qualityScores: Map<string, number>,
): FusedSearchScore[] {
  const laneRanks = new Map<string, Partial<Record<RetrievalLane, number>>>();
  const supportedClaims = new Map<string, Set<string>>();

  const addLaneRanks = (
    lane: RetrievalLane,
    rows: RankedLaneRow[],
  ): void => {
    rows.forEach((row, index) => {
      const rank = row.rank ?? index + 1;
      const ranks = laneRanks.get(row.id) ?? {};
      const existing = ranks[lane];
      if (!existing || rank < existing) {
        ranks[lane] = rank;
      }
      laneRanks.set(row.id, ranks);
    });
  };

  addLaneRanks(
    lanes.isNavigational ? "exact" : "official_text",
    lanes.courseKeywordResults,
  );
  addLaneRanks("section_text", lanes.sectionKeywordResults);
  addLaneRanks("requirement", lanes.requirementResults);
  addLaneRanks("structured_section", lanes.structuredSectionResults);
  addLaneRanks("student_language_alias", lanes.aliasResults);
  addLaneRanks(
    "topic_semantic",
    lanes.semanticResults.map((row, index) => ({
      id: row.id,
      rank: index + 1,
    })),
  );
  addLaneRanks("workload_evidence", lanes.workloadResults);
  for (const row of lanes.workloadResults) {
    supportedClaims.set(row.id, new Set(row.claims));
  }

  const scores: FusedSearchScore[] = [];
  for (const id of laneRanks.keys()) {
    let score = 0;
    const ranks = laneRanks.get(id) ?? {};
    const semanticRank = ranks.topic_semantic;
    const keywordRank = bestKeywordLikeRank(ranks);
    const qualityTierRank = getQualityTierRank(qualityScores.get(id));

    for (const [lane, rank] of Object.entries(ranks) as [RetrievalLane, number][]) {
      score += laneRrfScore(lane, rank);
      if (lane === "exact") score += 3.5;
    }
    if (qualityTierRank !== null) {
      score += qualityTierRank * COURSE_USEFULNESS_POLICY.FUSION.QUALITY_TIER_WEIGHT;
    }

    scores.push({
      id,
      score,
      semanticRank,
      keywordRank,
      laneMatches: Object.keys(ranks) as RetrievalLane[],
      laneRanks: ranks,
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

export function applyTitleBoost<T extends { id: string; score: number; title?: string }>(
  scores: T[],
  query: string,
): T[] {
  const queryLower = query.toLowerCase().trim();
  if (!queryLower) return scores;

  return scores.map(item => {
    if (!item.title) return item;

    const titleLower = item.title.toLowerCase();
    let boost = 0;

    if (titleLower === queryLower) {
      boost = 2.5;
    } else if (titleLower.includes(queryLower)) {
      boost = 1.2;
    } else if (queryLower.includes(titleLower)) {
      boost = 0.45;
    }

    return { ...item, score: item.score + boost };
  }).sort((a, b) => b.score - a.score);
}

function laneRrfScore(lane: RetrievalLane, rank: number): number {
  return LANE_WEIGHTS[lane] / (RRF_K + rank);
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
