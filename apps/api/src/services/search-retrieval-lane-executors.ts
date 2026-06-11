import type { Ai, D1Database, VectorizeIndex } from "@cloudflare/workers-types";
import { searchCourses as semanticSearch } from "./embeddings.js";
import { errorFields, logger } from "../observability/logger.js";
import type {
  RetrievalLaneExecution,
  RetrievalPlan,
} from "./search-retrieval-plan.js";
import {
  exactCourseSearch,
  keywordSearch,
  structuredCourseSearch,
} from "./search-retrieval-course-lanes.js";
import {
  postFilterSemanticResults,
  sectionKeywordSearch,
} from "./search-retrieval-section-lanes.js";
import type { RetrievalLane, RetrievalLaneResult } from "./search-types.js";

type RetrievalLaneExecutorContext = {
  db: D1Database;
  vectorize: VectorizeIndex;
  ai: Ai;
  retrievalPlan: RetrievalPlan;
};

type RetrievalLaneExecutor = (
  context: RetrievalLaneExecutorContext,
  lane: RetrievalLaneExecution,
) => Promise<RetrievalLaneResult[]>;

const RETRIEVAL_LANE_EXECUTORS: Record<RetrievalLane, RetrievalLaneExecutor> = {
  exact: ({ db, retrievalPlan }, laneExecution) => {
    return exactCourseSearch(
      db,
      retrievalPlan.inputs.filters,
      laneExecution.limit,
      retrievalPlan.inputs.scope,
    );
  },
  official_text: ({ db, retrievalPlan }, laneExecution) => {
    return keywordSearch(db, retrievalPlan.inputs, laneExecution.limit);
  },
  structured_course: ({ db, retrievalPlan }, laneExecution) => {
    return structuredCourseSearch(
      db,
      retrievalPlan.inputs.filters,
      laneExecution.limit,
      retrievalPlan.inputs.scope,
    );
  },
  section_text: ({ db, retrievalPlan }, laneExecution) => {
    return sectionKeywordSearch(
      db,
      retrievalPlan.inputs.cleanKeywordQuery,
      retrievalPlan.inputs.filters,
      laneExecution.limit,
      retrievalPlan.inputs.scope,
    );
  },
  topic_semantic: async ({ db, vectorize, ai, retrievalPlan }, laneExecution) => {
    const rawSemanticResults = await semanticSearch(
      vectorize,
      ai,
      retrievalPlan.inputs.semanticQuery,
      {
        filters: retrievalPlan.inputs.filters,
        topK: laneExecution.limit,
        termIds: retrievalPlan.inputs.semanticTermIds,
      },
    );
    const semanticResults = await postFilterSemanticResults(
      db,
      rawSemanticResults,
      retrievalPlan.inputs.filters,
      retrievalPlan.inputs.scope,
    );
    return semanticResults.map((row, index): RetrievalLaneResult => ({
      id: row.id,
      lane: "topic_semantic",
      rank: index + 1,
      rawScore: row.score,
      reason: "Semantic topic recall.",
      matchedTerms: [retrievalPlan.inputs.semanticQuery].filter(Boolean),
    }));
  },
};

export type RetrievalExecutionResult = {
  laneResults: RetrievalLaneResult[];
  successfulLanes: RetrievalLane[];
};

export async function executeRetrievalLanes(
  context: RetrievalLaneExecutorContext,
): Promise<RetrievalExecutionResult> {
  const laneRuns = context.retrievalPlan.lanes.map(async laneExecution => {
    const executor = RETRIEVAL_LANE_EXECUTORS[laneExecution.lane];
    try {
      return {
        failed: false as const,
        lane: laneExecution.lane,
        rows: await executor(context, laneExecution),
      };
    } catch (err) {
      logger.warn(`search.${laneExecution.lane}.failed`, { ...errorFields(err) });
      return {
        failed: true as const,
        lane: laneExecution.lane,
        rows: [] as RetrievalLaneResult[],
      };
    }
  });

  const runs = await Promise.all(laneRuns);
  if (runs.length > 0 && runs.every((run) => run.failed)) {
    throw new Error("All search retrieval lanes failed");
  }
  return {
    laneResults: runs.flatMap((run) => run.rows),
    successfulLanes: runs
      .filter((run) => !run.failed)
      .map((run) => run.lane),
  };
}
