import type { D1Database } from "@cloudflare/workers-types";
import type { SearchFilters } from "./search-planner-types.js";
import {
  buildFilteredCourseQuery,
  RETRIEVAL_LANE_SPECS,
} from "./search-lane-query-builder.js";
import {
  rankedLaneRow,
  type RankedLaneRow,
} from "./search-retrieval-lane-result.js";

export async function studentAliasLaneSearch(
  db: D1Database,
  filters: SearchFilters,
  aliasQuery: string,
  limit: number = 50,
): Promise<RankedLaneRow[]> {
  if (!aliasQuery) {
    return [];
  }

  const filtered = buildFilteredCourseQuery(filters);

  const sql = `
    SELECT DISTINCT c.id, bm25(course_aliases_fts) as fts_score
    FROM course_aliases_fts fts
    JOIN course_aliases ca ON ca.rowid = fts.rowid
    JOIN courses c ON c.id = ca.course_id
    ${filtered.joinSql}
    ${filtered.whereSql(["course_aliases_fts MATCH ?"])}
    ${filtered.groupBySql()}
    ${filtered.havingSql}
    ORDER BY fts_score ASC
    LIMIT ?
  `;

  const result = await db.prepare(sql)
    .bind(...filtered.bindParams([aliasQuery], [limit]))
    .all<{ id: string; fts_score: number }>();

  return result.results.map((row, index) => rankedLaneRow(
    "student_language_alias",
    row.id,
    index,
    RETRIEVAL_LANE_SPECS.student_language_alias.resultReason,
    { rawScore: row.fts_score, matchedTerms: [aliasQuery] },
  ));
}
