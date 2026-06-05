import type { Ai, D1Database, VectorizeIndex } from "@cloudflare/workers-types";
import { fuseRetrievalResults } from "./search-fusion.js";
import {
  fetchCoursesById,
  fetchRequirementCodesByCourseId,
} from "./search-loaders.js";
import { applyRankingPolicy } from "./ranking/index.js";
import { executeRetrievalLanes } from "./search-retrieval-lane-executors.js";
import type { RetrievalPlan } from "./search-retrieval-plan.js";
import type { SearchResult } from "./search-types.js";

export async function hybridSearch(
  db: D1Database,
  vectorize: VectorizeIndex,
  ai: Ai,
  retrievalPlan: RetrievalPlan,
): Promise<SearchResult[]> {
  const { plan, budget } = retrievalPlan;
  const laneResults = await executeRetrievalLanes({
    db,
    vectorize,
    ai,
    retrievalPlan,
  });
  const scores = fuseRetrievalResults({
    laneResults,
  });

  if (scores.length === 0) {
    return [];
  }

  const courseIds = scores.map(score => score.id);
  const [courseMap, requirementCodesByCourseId] = await Promise.all([
    fetchCoursesById(db, courseIds),
    fetchRequirementCodesByCourseId(db, courseIds),
  ]);

  const rankedResults: SearchResult[] = [];
  for (const score of scores) {
    const course = courseMap.get(score.id);
    if (!course) continue;
    rankedResults.push({
      course,
      score: score.score,
      semanticRank: score.semanticRank,
      keywordRank: score.keywordRank,
      laneMatches: score.laneMatches,
      laneRanks: score.laneRanks,
      requirementCodes: requirementCodesByCourseId.get(score.id),
      laneResults: score.laneResults,
      supportedSubjectiveClaims: score.supportedSubjectiveClaims,
    });
  }

  return applyRankingPolicy(rankedResults, plan, {
    query: plan.keywordQuery || "",
  }).slice(0, budget.termCandidateLimit);
}
