import type { D1Database } from "@cloudflare/workers-types";
import { buildFilteredCourseQuery } from "./search-lane-query-builder.js";
import type { RetrievalPlan } from "./search-retrieval-plan.js";
import { escapeLike } from "./search-text.js";
import type { RetrievalLaneResult } from "./search-types.js";

type CandidateQuery = {
  sql: string;
  params: (string | number)[];
};

/**
 * Counts the exact union described by the executable retrieval plan. SQL lanes
 * are counted without their browse limits; semantic recall contributes the
 * concrete, post-filtered Vectorize matches that actually exist in this run.
 */
export async function countSearchCandidates(
  db: D1Database,
  retrievalPlan: RetrievalPlan,
  laneResults: RetrievalLaneResult[],
): Promise<number> {
  const enabledLanes = new Set(retrievalPlan.lanes.map(({ lane }) => lane));
  const candidates: CandidateQuery[] = [];

  if (enabledLanes.has("exact") || enabledLanes.has("structured_course")) {
    candidates.push(filteredCourseCandidates(retrievalPlan));
  }
  if (enabledLanes.has("official_text")) {
    candidates.push(courseFtsCandidates(retrievalPlan));
    if (retrievalPlan.inputs.titleQuery) {
      candidates.push(titleCandidates(retrievalPlan));
    }
  }
  if (enabledLanes.has("section_text")) {
    candidates.push(sectionFtsCandidates(retrievalPlan));
  }

  const semanticIds = [
    ...new Set(
      laneResults
        .filter(({ lane }) => lane === "topic_semantic")
        .map(({ id }) => id),
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

function filteredCourseCandidates(retrievalPlan: RetrievalPlan): CandidateQuery {
  const filtered = buildFilteredCourseQuery(
    retrievalPlan.inputs.filters,
    retrievalPlan.inputs.scope,
  );
  return {
    sql: `
      SELECT DISTINCT c.id
      FROM courses c
      ${filtered.joinSql}
      ${filtered.whereSql()}
    `,
    params: filtered.bindParams(),
  };
}

function titleCandidates(retrievalPlan: RetrievalPlan): CandidateQuery {
  const filtered = buildFilteredCourseQuery(
    retrievalPlan.inputs.filters,
    retrievalPlan.inputs.scope,
  );
  return {
    sql: `
      SELECT DISTINCT c.id
      FROM courses c
      ${filtered.joinSql}
      ${filtered.whereSql(["LOWER(c.title) LIKE ? ESCAPE '\\'"])}
    `,
    params: filtered.bindParams([
      `%${escapeLike(retrievalPlan.inputs.titleQuery)}%`,
    ]),
  };
}

function courseFtsCandidates(retrievalPlan: RetrievalPlan): CandidateQuery {
  const filtered = buildFilteredCourseQuery(
    retrievalPlan.inputs.filters,
    retrievalPlan.inputs.scope,
  );
  return {
    sql: `
      SELECT DISTINCT c.id
      FROM courses_fts fts
      JOIN courses c ON c.rowid = fts.rowid
      ${filtered.joinSql}
      ${filtered.whereSql(["courses_fts MATCH ?"])}
    `,
    params: filtered.bindParams([retrievalPlan.inputs.cleanKeywordQuery]),
  };
}

function sectionFtsCandidates(retrievalPlan: RetrievalPlan): CandidateQuery {
  const filtered = buildFilteredCourseQuery(
    retrievalPlan.inputs.filters,
    retrievalPlan.inputs.scope,
  );
  return {
    sql: `
      SELECT DISTINCT c.id
      FROM sections_fts fts
      JOIN sections s ON s.rowid = fts.rowid
      JOIN courses c ON s.course_id = c.id
      ${filtered.joinSqlExcluding(["sections"])}
      ${filtered.whereSql(["sections_fts MATCH ?"])}
    `,
    params: filtered.bindParams([retrievalPlan.inputs.cleanKeywordQuery]),
  };
}
