import type { D1Database } from "@cloudflare/workers-types";
import type { SearchFilters } from "./search-planner-types.js";
import { buildFilteredCourseQuery } from "./search-lane-query-builder.js";
import {
  rankedLaneRow,
  type RankedLaneRow,
} from "./search-retrieval-lane-result.js";
import { escapeLike } from "./search-text.js";

export type CourseKeywordLaneInput = {
  filters: SearchFilters;
  keywordQuery: string;
  cleanKeywordQuery: string;
  titleQuery: string;
};

export async function titleKeywordSearch(
  db: D1Database,
  keywordQuery: string,
  filters: SearchFilters,
  limit: number = 20,
): Promise<RankedLaneRow[]> {
  const titleNeedle = keywordQuery.replace(/"/g, "").toLowerCase().trim();
  if (!titleNeedle) return [];

  const filtered = buildFilteredCourseQuery(filters);
  const titlePrefix = `${escapeLike(titleNeedle)}%`;
  const titleContains = `%${escapeLike(titleNeedle)}%`;
  const titleWhere = "LOWER(c.title) LIKE ? ESCAPE '\\'";

  const sql = `
    SELECT c.id,
      MIN(CASE
        WHEN LOWER(c.title) = ? THEN 1
        WHEN LOWER(c.title) LIKE ? ESCAPE '\\' THEN 2
        ELSE 3
      END) as title_rank
    FROM courses c
    ${filtered.joinSql}
    ${filtered.whereSql([titleWhere])}
    ${filtered.groupBySql("c.id")}
    ${filtered.havingSql}
    ORDER BY title_rank ASC,
      c.year DESC,
      CASE c.term WHEN 'fall' THEN 1 WHEN 'spring' THEN 2 WHEN 'summer' THEN 3 ELSE 4 END,
      c.subject,
      c.number
    LIMIT ?
  `;

  const result = await db.prepare(sql)
    .bind(titleNeedle, titlePrefix, ...filtered.bindParams([titleContains], [limit]))
    .all<{ id: string; title_rank: number }>();

  return result.results.map((row, index) => rankedLaneRow(
    "official_text",
    row.id,
    index,
    row.title_rank === 1 ? "Exact title recall." : "Title prefix or contains recall.",
    { rawScore: row.title_rank, matchedTerms: [titleNeedle] },
  ));
}

export async function keywordSearch(
  db: D1Database,
  input: CourseKeywordLaneInput,
  limit: number = 50,
): Promise<RankedLaneRow[]> {
  const { filters, keywordQuery, cleanKeywordQuery, titleQuery } = input;

  if (filters.subject && filters.number && !keywordQuery?.trim()) {
    const exactSql = `
      SELECT id FROM courses
      WHERE subject = ? AND number = ?
      ORDER BY year DESC,
        CASE term WHEN 'spring' THEN 1 WHEN 'fall' THEN 2 WHEN 'summer' THEN 3 ELSE 4 END
      LIMIT ?
    `;
    const exactResult = await db.prepare(exactSql)
      .bind(filters.subject, filters.number, limit)
      .all<{ id: string }>();

    if (exactResult.results.length > 0) {
      return exactResult.results.map((row, index) => rankedLaneRow(
        "exact",
        row.id,
        index,
        `Exact course code lookup for ${filters.subject} ${filters.number}.`,
        { matchedTerms: [`${filters.subject} ${filters.number}`] },
      ));
    }
  }

  if (filters.crn) {
    const crnSql = `
      SELECT DISTINCT c.id
      FROM sections s
      JOIN courses c ON s.course_id = c.id
      WHERE s.crn = ?
      LIMIT 1
    `;
    const crnResult = await db.prepare(crnSql)
      .bind(filters.crn)
      .all<{ id: string }>();
    if (crnResult.results.length > 0) {
      return crnResult.results.map((row, index) => rankedLaneRow(
        "exact",
        row.id,
        index,
        `Exact CRN lookup for ${filters.crn}.`,
        { matchedTerms: [filters.crn!] },
      ));
    }
  }

  const filtered = buildFilteredCourseQuery(filters);
  const hasKeyword = keywordQuery && keywordQuery.trim().length > 0;
  const titleResults = titleQuery
    ? await titleKeywordSearch(db, titleQuery, filters, limit)
    : [];
  const ftsMatchCondition = "courses_fts MATCH ?";

  const sql = hasKeyword ? `
    SELECT DISTINCT c.id, bm25(courses_fts, 10.0, 10.0, 2.0, 0.5, 1.0, 1.0) as fts_score
    FROM courses_fts fts
    JOIN courses c ON c.rowid = fts.rowid
    ${filtered.joinSql}
    ${filtered.whereSql([ftsMatchCondition])}
    ORDER BY fts_score ASC
    LIMIT ?
  ` : `
    SELECT DISTINCT c.id, 0 as fts_score
    FROM courses c
    ${filtered.joinSql}
    ${filtered.whereSql()}
    ORDER BY c.year DESC, c.subject, c.number
    LIMIT ?
  `;

  const result = await db.prepare(sql)
    .bind(...(hasKeyword ? filtered.bindParams([cleanKeywordQuery], [limit]) : filtered.bindParams([limit])))
    .all<{ id: string; fts_score: number }>();

  const ftsResults = result.results.map((row, index) => rankedLaneRow(
    "official_text",
    row.id,
    index,
    hasKeyword ? "Official course text FTS recall." : "Structured course-filter recall.",
    {
      rawScore: row.fts_score,
      matchedTerms: hasKeyword ? [cleanKeywordQuery] : undefined,
    },
  ));
  if (titleResults.length === 0) {
    return ftsResults;
  }

  const seen = new Set<string>();
  const combined: RankedLaneRow[] = [];
  for (const row of [...titleResults, ...ftsResults]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    combined.push({ ...row, rank: combined.length + 1 });
    if (combined.length >= limit) break;
  }

  return combined;
}
