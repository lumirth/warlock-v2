import type { RetrievalLane } from "./search-planner-types.js";
import type { RetrievalLaneResult } from "./search-types.js";

export type RankedLaneRow = RetrievalLaneResult;
export type WorkloadLaneRow = RankedLaneRow & { claims: string[] };

export function rankedLaneRow(
  lane: RetrievalLane,
  id: string,
  index: number,
  reason: string,
  options: {
    rawScore?: number | null;
    matchedTerms?: string[];
    evidence?: string[];
  } = {},
): RankedLaneRow {
  return {
    id,
    lane,
    rank: index + 1,
    reason,
    rawScore: options.rawScore ?? undefined,
    matchedTerms: options.matchedTerms,
    evidence: options.evidence,
  };
}
