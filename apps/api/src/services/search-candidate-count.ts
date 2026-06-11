import type { D1Database } from "@cloudflare/workers-types";
import type { CandidateSqlQuery } from "./search-lane-query-builder.js";
import {
  buildCourseFtsCandidateQuery,
  buildFilteredCourseCandidateQuery,
  buildTitleCandidateQuery,
} from "./search-retrieval-course-lanes.js";
import type { RetrievalExecutionResult } from "./search-retrieval-lane-executors.js";
import type { RetrievalPlan } from "./search-retrieval-plan.js";
import { buildSectionFtsCandidateQuery } from "./search-retrieval-section-lanes.js";

/**
 * Counts the exact union described by the executable retrieval plan. SQL lanes
 * are counted without their browse limits; semantic recall contributes the
 * concrete, post-filtered Vectorize matches that actually exist in this run.
 */
export async function countSearchCandidates(
  db: D1Database,
  retrievalPlan: RetrievalPlan,
  execution: RetrievalExecutionResult,
): Promise<number> {
  const completedLanes = new Set(execution.successfulLanes);
  const candidates: CandidateSqlQuery[] = [];

  if (completedLanes.has("exact") || completedLanes.has("structured_course")) {
    candidates.push(buildFilteredCourseCandidateQuery(
      retrievalPlan.inputs.filters,
      retrievalPlan.inputs.scope,
    ));
  }
  if (completedLanes.has("official_text")) {
    addCandidate(candidates, buildCourseFtsCandidateQuery(
      retrievalPlan.inputs.cleanKeywordQuery,
      retrievalPlan.inputs.filters,
      retrievalPlan.inputs.scope,
    ));
    addCandidate(candidates, buildTitleCandidateQuery(
      retrievalPlan.inputs.titleQuery,
      retrievalPlan.inputs.filters,
      retrievalPlan.inputs.scope,
    ));
  }
  if (completedLanes.has("section_text")) {
    addCandidate(candidates, buildSectionFtsCandidateQuery(
      retrievalPlan.inputs.cleanKeywordQuery,
      retrievalPlan.inputs.filters,
      retrievalPlan.inputs.scope,
    ));
  }

  const semanticIds = [
    ...new Set(
      completedLanes.has("topic_semantic")
        ? execution.laneResults
          .filter(({ lane }) => lane === "topic_semantic")
          .map(({ id }) => id)
        : [],
    ),
  ];
  if (semanticIds.length > 0) {
    candidates.push({
      sql: semanticIds.map(() => "SELECT ? AS id").join(" UNION ALL "),
      params: semanticIds,
    });
  }

  if (candidates.length === 0) return 0;

  const result = await db.prepare(`
    SELECT COUNT(DISTINCT id) AS total
    FROM (
      ${candidates.map(({ sql }) => sql).join("\nUNION ALL\n")}
    ) search_candidates
  `)
    .bind(...candidates.flatMap(({ params }) => params))
    .first<{ total: number }>();

  if (!result || !Number.isFinite(result.total)) {
    throw new Error("Search candidate count did not return a total");
  }
  return result.total;
}

function addCandidate(
  candidates: CandidateSqlQuery[],
  candidate: CandidateSqlQuery | null,
): void {
  if (candidate) candidates.push(candidate);
}
