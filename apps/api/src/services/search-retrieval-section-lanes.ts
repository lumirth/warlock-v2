import type { D1Database } from "@cloudflare/workers-types";
import {
  DEFAULT_SEARCH_SORT,
  type SearchScope,
  type SearchSort,
} from "@uiuc-course-search/query-types";
import type { SearchFilters } from "./search-planner-types.js";
import {
  buildFilteredCourseQuery,
  type CandidateSqlQuery,
} from "./search-lane-query-builder.js";
import { chunkValues } from "./search-loaders.js";
import { rankedLaneRow } from "./search-retrieval-lane-result.js";
import type { RetrievalLaneResult } from "./search-types.js";
import { courseSqlOrderBy } from "./search-sql-sort.js";

export function buildSectionFtsCandidateQuery(
  cleanKeywordQuery: string,
  filters: SearchFilters,
  scope: SearchScope = "all",
): CandidateSqlQuery | null {
  if (!cleanKeywordQuery.trim()) return null;

  const filtered = buildFilteredCourseQuery(filters, scope);
  return {
    sql: `
      SELECT DISTINCT c.id, bm25(sections_fts) as fts_score
      FROM sections_fts fts
      JOIN sections s ON s.rowid = fts.rowid
      JOIN courses c ON s.course_id = c.id
      ${filtered.joinSqlExcluding(["sections"])}
      ${filtered.whereSql(["sections_fts MATCH ?"])}
    `,
    params: filtered.bindParams([cleanKeywordQuery]),
  };
}

export async function sectionKeywordSearch(
  db: D1Database,
  cleanKeywordQuery: string,
  filters: SearchFilters,
  limit: number = 50,
  scope: SearchScope = "all",
  sort: SearchSort = DEFAULT_SEARCH_SORT,
): Promise<RetrievalLaneResult[]> {
  const candidateQuery = buildSectionFtsCandidateQuery(cleanKeywordQuery, filters, scope);
  if (!candidateQuery) return [];

  const result = await db.prepare(`
    SELECT candidates.id, candidates.fts_score
    FROM (${candidateQuery.sql}) candidates
    JOIN courses c ON c.id = candidates.id
    ORDER BY ${courseSqlOrderBy(sort, "fts_score ASC")}
    LIMIT ?
  `)
    .bind(...candidateQuery.params, limit)
    .all<{ id: string; fts_score: number }>();

  return result.results.map((row, index) => rankedLaneRow(
    "section_text",
    row.id,
    index,
    "Section text FTS recall.",
    { rawScore: row.fts_score, matchedTerms: [cleanKeywordQuery] },
  ));
}

export async function postFilterSemanticResults(
  db: D1Database,
  semanticResults: { id: string; score: number }[],
  filters: SearchFilters,
  scope: SearchScope = "all",
): Promise<{ id: string; score: number }[]> {
  if (semanticResults.length === 0) return [];

  const filtered = buildFilteredCourseQuery(filters, scope);

  const courseIds = semanticResults.map((row) => row.id);
  const validIdSet = new Set<string>();

  for (const batch of chunkValues(courseIds, 50)) {
    const placeholders = batch.map(() => "?").join(",");

    const sql = `
      SELECT c.id
      FROM courses c
      ${filtered.joinSql}
      ${filtered.whereSql([`c.id IN (${placeholders})`])}
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
