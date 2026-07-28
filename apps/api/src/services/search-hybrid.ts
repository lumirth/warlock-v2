import type { Ai, D1Database, VectorizeIndex } from "@cloudflare/workers-types";
import { fuseRetrievalResults } from "./search-fusion.js";
import {
  fetchCoursesById,
  fetchRegistrationSummariesByCourseId,
  fetchRequirementsByCourseId,
} from "./search-loaders.js";
import { applyRankingPolicy } from "./ranking/index.js";
import { executeRetrievalLanes } from "./search-retrieval-lane-executors.js";
import type { RetrievalExecutionResult } from "./search-retrieval-lane-executors.js";
import { countSearchCandidates } from "./search-candidate-count.js";
import type { RetrievalPlan } from "./search-retrieval-plan.js";
import type { SearchPlan } from "./search-planner-types.js";
import type { SearchResult } from "./search-types.js";
import { MAX_HYDRATED_SEARCH_CANDIDATES } from "./search-budget.js";
import { orderRetrievedCandidatesByCourseSort } from "./search-sql-sort.js";

export type SearchCandidateWindow = {
  retrievedCandidates: number;
  hydrationLimit: number;
  truncated: boolean;
};

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
  candidateWindow: SearchCandidateWindow;
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
  const fusedScores = fuseRetrievalResults({
    laneResults,
  });
  const scores = await orderRetrievedCandidatesByCourseSort(
    db,
    fusedScores,
    retrievalPlan.controls.sort,
  );
  const hydrationLimit = Math.min(
    budget.browseableResultLimit,
    MAX_HYDRATED_SEARCH_CANDIDATES,
  );
  const candidateWindow: SearchCandidateWindow = {
    retrievedCandidates: scores.length,
    hydrationLimit,
    truncated:
      scores.length > hydrationLimit
      || totalResults > Math.min(scores.length, hydrationLimit),
  };

  if (scores.length === 0) {
    return {
      results: [],
      totalResults,
      retrievalExecution: execution,
      candidateWindow,
    };
  }

  const scoresToHydrate = scores.slice(0, hydrationLimit);
  const courseIds = scoresToHydrate.map(score => score.id);
  const [courseMap, requirementsByCourseId, registrationSummariesByCourseId] = await Promise.all([
    fetchCoursesById(db, courseIds),
    fetchRequirementsByCourseId(db, courseIds),
    fetchRegistrationSummariesByCourseId(db, courseIds),
  ]);

  const rankedResults: SearchResult[] = [];
  for (const score of scoresToHydrate) {
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
      registrationSummary: registrationSummariesByCourseId.get(score.id),
      laneResults: score.laneResults,
    });
  }

  return {
    results: applyRankingPolicy(rankedResults, rankingPlan, {
      query: rankingPlan.keywordQuery || "",
    }).slice(0, budget.browseableResultLimit),
    totalResults,
    retrievalExecution: execution,
    candidateWindow,
  };
}
