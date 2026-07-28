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

const D1_MAX_BOUND_PARAMETERS = 100;

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

  if (candidates.length === 0) return semanticIds.length;

  const candidateSql = candidates.map(({ sql }) => sql).join("\nUNION ALL\n");
  const candidateParams = candidates.flatMap(({ params }) => params);
  if (candidateParams.length > D1_MAX_BOUND_PARAMETERS) {
    throw new Error(
      `Search candidate count requires ${candidateParams.length} SQL bindings; `
      + `maximum is ${D1_MAX_BOUND_PARAMETERS}`,
    );
  }

  const sqlTotal = await runCount(db, `
    SELECT COUNT(DISTINCT id) AS total
    FROM (
      ${candidateSql}
    ) search_candidates
  `, candidateParams);

  if (semanticIds.length === 0) return sqlTotal;
  if (candidateParams.length === D1_MAX_BOUND_PARAMETERS) {
    throw new Error(
      `Search candidate count uses all ${D1_MAX_BOUND_PARAMETERS} SQL bindings; `
      + 'no binding remains to merge semantic candidates',
    );
  }

  const semanticChunkSize = D1_MAX_BOUND_PARAMETERS - candidateParams.length;
  let semanticOverlap = 0;
  for (let offset = 0; offset < semanticIds.length; offset += semanticChunkSize) {
    const semanticChunk = semanticIds.slice(offset, offset + semanticChunkSize);
    const semanticSql = semanticChunk
      .map(() => "SELECT ? AS id")
      .join(" UNION ALL ");
    semanticOverlap += await runCount(db, `
      SELECT COUNT(DISTINCT semantic_candidates.id) AS total
      FROM (
        ${semanticSql}
      ) semantic_candidates
      JOIN (
        ${candidateSql}
      ) search_candidates ON search_candidates.id = semantic_candidates.id
    `, [...semanticChunk, ...candidateParams]);
  }

  return sqlTotal + semanticIds.length - semanticOverlap;
}

async function runCount(
  db: D1Database,
  sql: string,
  params: unknown[],
): Promise<number> {
  const result = await db.prepare(sql)
    .bind(...params)
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
