import type { Ai, D1Database, VectorizeIndex } from "@cloudflare/workers-types";
import { fuseRetrievalResults } from "./search-fusion.js";
import {
  fetchCoursesById,
  fetchRequirementsByCourseId,
} from "./search-loaders.js";
import { applyRankingPolicy } from "./ranking/index.js";
import { executeRetrievalLanes } from "./search-retrieval-lane-executors.js";
import type { RetrievalExecutionResult } from "./search-retrieval-lane-executors.js";
import { countSearchCandidates } from "./search-candidate-count.js";
import type { RetrievalPlan } from "./search-retrieval-plan.js";
import type { SearchPlan } from "./search-planner-types.js";
import type { SearchResult } from "./search-types.js";

export async function hybridSearch(
  db: D1Database,
  vectorize: VectorizeIndex,
  ai: Ai,
  retrievalPlan: RetrievalPlan,
  rankingPlan: SearchPlan,
): Promise<{
  results: SearchResult[];
  totalResults: number;
  retrievalExecution: RetrievalExecutionResult;
}> {
  const { budget } = retrievalPlan;
  const execution = await executeRetrievalLanes({
    db,
    vectorize,
    ai,
    retrievalPlan,
  });
  const { laneResults } = execution;
  const totalResults = await countSearchCandidates(db, retrievalPlan, execution);
  const scores = fuseRetrievalResults({
    laneResults,
  });

  if (scores.length === 0) {
    return { results: [], totalResults, retrievalExecution: execution };
  }

  const courseIds = scores.map(score => score.id);
  const [courseMap, requirementsByCourseId] = await Promise.all([
    fetchCoursesById(db, courseIds),
    fetchRequirementsByCourseId(db, courseIds),
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
      requirements: requirementsByCourseId.get(score.id) ?? [],
      laneResults: score.laneResults,
    });
  }

  return {
    results: applyRankingPolicy(rankedResults, rankingPlan, {
      query: rankingPlan.keywordQuery || "",
    }).slice(0, budget.browseableResultLimit),
    totalResults,
    retrievalExecution: execution,
  };
}
