import type { Ai, D1Database, VectorizeIndex } from "@cloudflare/workers-types";
import { searchCourses as semanticSearch } from "./embeddings.js";
import { errorFields, logger } from "../observability/logger.js";
import { applyTitleBoost, fuseRetrievalResults } from "./search-fusion.js";
import { fetchCoursesById, fetchQualityScores } from "./search-loaders.js";
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
import type { SearchResult } from "./search-types.js";
import { applyUsefulnessRerank } from "./search-usefulness.js";

export async function hybridSearch(
  db: D1Database,
  vectorize: VectorizeIndex,
  ai: Ai,
  retrievalPlan: RetrievalPlan,
): Promise<SearchResult[]> {
  const { effectivePlan, budget } = retrievalPlan;
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
          effectivePlan.semanticQuery,
          effectivePlan.filters,
          laneLimit,
        ).catch(err => {
          logger.warn("search.semantic.failed", { ...errorFields(err) });
          return [];
        })
      : Promise.resolve([]),
    keywordSearch(db, effectivePlan, laneLimit),
    retrievalPlan.hasKeywordQuery && laneEnabled(retrievalPlan, "section_text")
      ? sectionKeywordSearch(
          db,
          effectivePlan.keywordQuery!,
          effectivePlan.filters,
          laneLimit,
        )
      : Promise.resolve([]),
    laneEnabled(retrievalPlan, "requirement")
      ? requirementLaneSearch(db, effectivePlan, laneLimit).catch(err => {
          logger.warn("search.requirement_lane.failed", { ...errorFields(err) });
          return [];
        })
      : Promise.resolve([]),
    laneEnabled(retrievalPlan, "structured_section")
      ? structuredSectionLaneSearch(db, effectivePlan, laneLimit).catch(err => {
          logger.warn("search.section_lane.failed", { ...errorFields(err) });
          return [];
        })
      : Promise.resolve([]),
    laneEnabled(retrievalPlan, "student_language_alias")
      ? studentAliasLaneSearch(
          db,
          effectivePlan,
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
          effectivePlan,
          laneLimit,
          retrievalPlan.workloadSignalTypes,
        ).catch(err => {
          logger.warn("search.workload_lane.failed", { ...errorFields(err) });
          return [];
        })
      : Promise.resolve([]),
  ]);

  const semanticResults = runSemantic
    ? await postFilterSemanticResults(db, rawSemanticResults, effectivePlan.filters)
    : [];
  const qualityScores = await fetchQualityScores(
    db,
    [
      ...new Set([
        ...courseKeywordResults.map(row => row.id),
        ...sectionKeywordResults.map(row => row.id),
        ...requirementResults.map(row => row.id),
        ...structuredSectionResults.map(row => row.id),
        ...aliasResults.map(row => row.id),
        ...semanticResults.map(row => row.id),
        ...workloadResults.map(row => row.id),
      ]),
    ],
  );
  const scores = fuseRetrievalResults(
    {
      isNavigational: retrievalPlan.isNavigational,
      courseKeywordResults,
      sectionKeywordResults,
      requirementResults,
      structuredSectionResults,
      aliasResults,
      semanticResults,
      workloadResults,
    },
    qualityScores,
  );

  if (scores.length === 0) {
    return [];
  }

  const courseMap = await fetchCoursesById(db, scores.map(score => score.id));
  const resultsWithTitles = scores.map(score => ({
    ...score,
    title: courseMap.get(score.id)?.title,
  }));

  const boostedResults = applyTitleBoost(
    resultsWithTitles,
    effectivePlan.keywordQuery || "",
  ).slice(0, budget.termCandidateLimit);

  const rankedResults: SearchResult[] = [];
  for (const score of boostedResults) {
    const course = courseMap.get(score.id);
    if (!course) continue;
    rankedResults.push({
      course,
      score: score.score,
      semanticRank: score.semanticRank,
      keywordRank: score.keywordRank,
      laneMatches: score.laneMatches,
      laneRanks: score.laneRanks,
      supportedSubjectiveClaims: score.supportedSubjectiveClaims,
    });
  }

  return applyUsefulnessRerank(rankedResults, effectivePlan);
}
