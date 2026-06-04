import type { Ai, D1Database, VectorizeIndex } from "@cloudflare/workers-types";
import { searchCourses as semanticSearch } from "./embeddings.js";
import { errorFields, logger } from "../observability/logger.js";
import { fuseRetrievalResults } from "./search-fusion.js";
import {
  fetchCoursesById,
  fetchRequirementCodesByCourseId,
} from "./search-loaders.js";
import { applyRankingPolicy } from "./ranking/index.js";
import { laneEnabled, type RetrievalPlan } from "./search-retrieval-plan.js";
import {
  keywordSearch,
  postFilterSemanticResults,
  requirementLaneSearch,
  sectionKeywordSearch,
  structuredSectionLaneSearch,
  studentAliasLaneSearch,
  workloadEvidenceLaneSearch,
} from "./search-retrieval-lanes.js";
import type { RetrievalLaneResult, SearchResult } from "./search-types.js";

export async function hybridSearch(
  db: D1Database,
  vectorize: VectorizeIndex,
  ai: Ai,
  retrievalPlan: RetrievalPlan,
): Promise<SearchResult[]> {
  const { plan, budget } = retrievalPlan;
  const laneLimit = budget.laneCandidateLimit;
  const runSemantic = laneEnabled(retrievalPlan, "topic_semantic");

  const [
    rawSemanticResults,
    courseKeywordResults,
    sectionKeywordResults,
    requirementResults,
    structuredSectionResults,
    aliasResults,
    workloadResults,
  ] = await Promise.all([
    runSemantic
      ? semanticSearch(
          vectorize,
          ai,
          plan.semanticQuery,
          plan.filters,
          laneLimit,
        ).catch(err => {
          logger.warn("search.semantic.failed", { ...errorFields(err) });
          return [];
        })
      : Promise.resolve([]),
    keywordSearch(db, plan, laneLimit),
    retrievalPlan.hasKeywordQuery && laneEnabled(retrievalPlan, "section_text")
      ? sectionKeywordSearch(
          db,
          plan.keywordQuery!,
          plan.filters,
          laneLimit,
        )
      : Promise.resolve([]),
    laneEnabled(retrievalPlan, "requirement")
      ? requirementLaneSearch(db, plan, laneLimit).catch(err => {
          logger.warn("search.requirement_lane.failed", { ...errorFields(err) });
          return [];
        })
      : Promise.resolve([]),
    laneEnabled(retrievalPlan, "structured_section")
      ? structuredSectionLaneSearch(db, plan, laneLimit).catch(err => {
          logger.warn("search.section_lane.failed", { ...errorFields(err) });
          return [];
        })
      : Promise.resolve([]),
    laneEnabled(retrievalPlan, "student_language_alias")
      ? studentAliasLaneSearch(
          db,
          plan,
          laneLimit,
          retrievalPlan.aliasQuery,
        ).catch(err => {
          logger.warn("search.alias_lane.failed", { ...errorFields(err) });
          return [];
        })
      : Promise.resolve([]),
    laneEnabled(retrievalPlan, "workload_evidence")
      ? workloadEvidenceLaneSearch(
          db,
          plan,
          laneLimit,
          retrievalPlan.workloadSignalTypes,
        ).catch(err => {
          logger.warn("search.workload_lane.failed", { ...errorFields(err) });
          return [];
        })
      : Promise.resolve([]),
  ]);

  const semanticResults = runSemantic
    ? (await postFilterSemanticResults(db, rawSemanticResults, plan.filters))
      .map((row, index): RetrievalLaneResult => ({
        id: row.id,
        lane: "topic_semantic",
        rank: index + 1,
        rawScore: row.score,
        reason: "Semantic topic recall.",
        matchedTerms: [plan.semanticQuery].filter(Boolean),
      }))
    : [];
  const scores = fuseRetrievalResults({
    isNavigational: retrievalPlan.isNavigational,
    courseKeywordResults,
    sectionKeywordResults,
    requirementResults,
    structuredSectionResults,
    aliasResults,
    semanticResults,
    workloadResults,
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
