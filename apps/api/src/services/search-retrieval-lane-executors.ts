import type { Ai, D1Database, VectorizeIndex } from "@cloudflare/workers-types";
import { searchCourses as semanticSearch } from "./embeddings.js";
import { errorFields, logger } from "../observability/logger.js";
import type { RetrievalLane } from "./search-planner-types.js";
import {
  enabledRetrievalLanes,
  type RetrievalLaneExecution,
  type RetrievalPlan,
} from "./search-retrieval-plan.js";
import {
  keywordSearch,
  postFilterSemanticResults,
  requirementLaneSearch,
  sectionKeywordSearch,
  structuredSectionLaneSearch,
  studentAliasLaneSearch,
  workloadEvidenceLaneSearch,
} from "./search-retrieval-lanes.js";
import type { RetrievalLaneResult } from "./search-types.js";

export type RetrievalLaneExecutorContext = {
  db: D1Database;
  vectorize: VectorizeIndex;
  ai: Ai;
  retrievalPlan: RetrievalPlan;
};

type RetrievalLaneExecutor = {
  lane: RetrievalLane;
  execute: (
    context: RetrievalLaneExecutorContext,
    lane: RetrievalLaneExecution,
  ) => Promise<RetrievalLaneResult[]>;
};

const keywordLaneExecutor = (lane: "exact" | "official_text"): RetrievalLaneExecutor => ({
  lane,
  execute: ({ db, retrievalPlan }, laneExecution) => {
    return keywordSearch(db, retrievalPlan.plan, laneExecution.limit);
  },
});

const RETRIEVAL_LANE_EXECUTORS: Record<RetrievalLane, RetrievalLaneExecutor> = {
  exact: keywordLaneExecutor("exact"),
  official_text: keywordLaneExecutor("official_text"),
  section_text: {
    lane: "section_text",
    execute: ({ db, retrievalPlan }, laneExecution) => {
      return sectionKeywordSearch(
        db,
        retrievalPlan.plan.keywordQuery,
        retrievalPlan.plan.filters,
        laneExecution.limit,
      );
    },
  },
  requirement: {
    lane: "requirement",
    execute: ({ db, retrievalPlan }, laneExecution) => {
      return requirementLaneSearch(db, retrievalPlan.plan, laneExecution.limit);
    },
  },
  structured_section: {
    lane: "structured_section",
    execute: ({ db, retrievalPlan }, laneExecution) => {
      return structuredSectionLaneSearch(db, retrievalPlan.plan, laneExecution.limit);
    },
  },
  student_language_alias: {
    lane: "student_language_alias",
    execute: ({ db, retrievalPlan }, laneExecution) => {
      return studentAliasLaneSearch(
        db,
        retrievalPlan.plan,
        laneExecution.limit,
        retrievalPlan.aliasQuery,
      );
    },
  },
  topic_semantic: {
    lane: "topic_semantic",
    execute: async ({ db, vectorize, ai, retrievalPlan }, laneExecution) => {
      const plan = retrievalPlan.plan;
      const rawSemanticResults = await semanticSearch(
        vectorize,
        ai,
        plan.semanticQuery,
        plan.filters,
        laneExecution.limit,
      );
      const semanticResults = await postFilterSemanticResults(
        db,
        rawSemanticResults,
        plan.filters,
      );
      return semanticResults.map((row, index): RetrievalLaneResult => ({
        id: row.id,
        lane: "topic_semantic",
        rank: index + 1,
        rawScore: row.score,
        reason: "Semantic topic recall.",
        matchedTerms: [plan.semanticQuery].filter(Boolean),
      }));
    },
  },
  workload_evidence: {
    lane: "workload_evidence",
    execute: ({ db, retrievalPlan }, laneExecution) => {
      return workloadEvidenceLaneSearch(
        db,
        retrievalPlan.plan,
        laneExecution.limit,
        retrievalPlan.workloadSignalTypes,
      );
    },
  },
  help_path: {
    lane: "help_path",
    execute: async () => [],
  },
};

export async function executeRetrievalLanes(
  context: RetrievalLaneExecutorContext,
): Promise<RetrievalLaneResult[]> {
  const laneRuns = enabledRetrievalLanes(context.retrievalPlan).map(async laneExecution => {
    const executor = RETRIEVAL_LANE_EXECUTORS[laneExecution.lane];
    try {
      return await executor.execute(context, laneExecution);
    } catch (err) {
      logger.warn(`search.${laneExecution.lane}.failed`, { ...errorFields(err) });
      return [];
    }
  });

  return (await Promise.all(laneRuns)).flat();
}
