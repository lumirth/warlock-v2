import type { RetrievalLane, RetrievalLaneResult } from "./search-types.js";

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
): RetrievalLaneResult {
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
