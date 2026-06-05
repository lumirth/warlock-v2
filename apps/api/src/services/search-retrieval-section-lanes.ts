import type { D1Database } from "@cloudflare/workers-types";
import type { SearchFilters } from "./search-planner-types.js";
import {
  buildFilteredCourseQuery,
  hasFilteredCourseConstraints,
  RETRIEVAL_LANE_SPECS,
} from "./search-lane-query-builder.js";
import { chunkValues } from "./search-loaders.js";
import {
  rankedLaneRow,
  type RankedLaneRow,
} from "./search-retrieval-lane-result.js";
import { sanitizeFtsQuery } from "./search-text.js";

export async function sectionKeywordSearch(
  db: D1Database,
  keywordQuery: string,
  filters: SearchFilters,
  limit: number = 50,
): Promise<RankedLaneRow[]> {
  if (!keywordQuery || !keywordQuery.trim()) {
    return [];
  }

  const filtered = buildFilteredCourseQuery(filters);
  const joinClause = filtered.joins
    .filter((join) => !join.includes("JOIN sections s "))
    .join(" ");

  const sql = `
    SELECT DISTINCT c.id, bm25(sections_fts) as fts_score
    FROM sections_fts fts
    JOIN sections s ON s.rowid = fts.rowid
    JOIN courses c ON s.course_id = c.id
    ${joinClause}
    ${filtered.whereSql(["sections_fts MATCH ?"])}
    ORDER BY fts_score ASC
    LIMIT ?
  `;

  const escapedQuery = sanitizeFtsQuery(keywordQuery);
  const result = await db.prepare(sql)
    .bind(...filtered.bindParams([escapedQuery], [limit]))
    .all<{ id: string; fts_score: number }>();

  return result.results.map((row, index) => rankedLaneRow(
    "section_text",
    row.id,
    index,
    "Section text FTS recall.",
    { rawScore: row.fts_score, matchedTerms: [escapedQuery] },
  ));
}

export async function structuredSectionLaneSearch(
  db: D1Database,
  filters: SearchFilters,
  limit: number = 50,
): Promise<RankedLaneRow[]> {
  const filtered = buildFilteredCourseQuery(filters);
  if (!hasFilteredCourseConstraints(filtered)) {
    return [];
  }

  const sql = `
    SELECT DISTINCT c.id
    FROM courses c
    ${filtered.joinSql}
    ${filtered.whereSql()}
    ${filtered.groupBySql()}
    ${filtered.havingSql}
    ORDER BY c.year DESC, c.subject, c.number
    LIMIT ?
  `;

  const result = await db.prepare(sql)
    .bind(...filtered.bindParams([limit]))
    .all<{ id: string }>();

  return result.results.map((row, index) => rankedLaneRow(
    "structured_section",
    row.id,
    index,
    RETRIEVAL_LANE_SPECS.structured_section.resultReason,
  ));
}

export async function postFilterSemanticResults(
  db: D1Database,
  semanticResults: { id: string; score: number }[],
  filters: SearchFilters,
): Promise<{ id: string; score: number }[]> {
  if (semanticResults.length === 0) return [];

  const hasActiveFilters = Object.values(filters).some((value) => {
    if (value === undefined || value === null) return false;
    return Array.isArray(value) ? value.length > 0 : true;
  });
  if (!hasActiveFilters) return semanticResults;

  const filtered = buildFilteredCourseQuery(filters);

  if (!hasFilteredCourseConstraints(filtered)) return semanticResults;

  const courseIds = semanticResults.map((row) => row.id);
  const validIdSet = new Set<string>();

  for (const batch of chunkValues(courseIds, 50)) {
    const placeholders = batch.map(() => "?").join(",");

    const sql = `
      SELECT c.id
      FROM courses c
      ${filtered.joinSql}
      ${filtered.whereSql([`c.id IN (${placeholders})`])}
      ${filtered.groupBySql()}
      ${filtered.havingSql}
    `;

    const finalParams = filtered.bindParams(batch);
    const validIdsResult = await db.prepare(sql)
      .bind(...finalParams)
      .all<{ id: string }>();
    for (const row of validIdsResult.results) {
      validIdSet.add(row.id);
    }
  }

  return semanticResults.filter((row) => validIdSet.has(row.id));
}
