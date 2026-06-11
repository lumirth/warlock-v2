import type { D1Database } from "@cloudflare/workers-types";
import type { SearchScope } from "@uiuc-course-search/query-types";
import type { SearchFilters } from "./search-planner-types.js";
import { buildFilteredCourseQuery } from "./search-lane-query-builder.js";
import { rankedLaneRow } from "./search-retrieval-lane-result.js";
import { escapeLike } from "./search-text.js";
import type { RetrievalLaneResult } from "./search-types.js";

type CourseKeywordLaneInput = {
  filters: SearchFilters;
  keywordQuery: string;
  cleanKeywordQuery: string;
  titleQuery: string;
  scope: SearchScope;
};

export async function structuredCourseSearch(
  db: D1Database,
  filters: SearchFilters,
  limit: number = 50,
  scope: SearchScope = "all",
): Promise<RetrievalLaneResult[]> {
  const filtered = buildFilteredCourseQuery(filters, scope);
  const result = await db.prepare(`
    SELECT DISTINCT c.id
    FROM courses c
    ${filtered.joinSql}
    ${filtered.whereSql()}
    ORDER BY c.year DESC, c.subject, c.number
    LIMIT ?
  `)
    .bind(...filtered.bindParams([limit]))
    .all<{ id: string }>();

  return result.results.map((row, index) => rankedLaneRow(
    "structured_course",
    row.id,
    index,
    "Structured course-filter recall.",
  ));
}

export async function exactCourseSearch(
  db: D1Database,
  filters: SearchFilters,
  limit: number = 50,
  scope: SearchScope = "all",
): Promise<RetrievalLaneResult[]> {
  const courseCode = filters.subject && filters.number
    ? `${filters.subject} ${filters.number}`
    : null;
  const exactTerm = courseCode ?? filters.crn;
  if (!exactTerm) return [];

  const filtered = buildFilteredCourseQuery(filters, scope);
  const result = await db.prepare(`
    SELECT DISTINCT c.id
    FROM courses c
    ${filtered.joinSql}
    ${filtered.whereSql()}
    ${filtered.groupBySql("c.id")}
    ORDER BY c.year DESC,
      CASE c.term WHEN 'spring' THEN 1 WHEN 'fall' THEN 2 WHEN 'summer' THEN 3 ELSE 4 END
    LIMIT ?
  `)
    .bind(...filtered.bindParams([limit]))
    .all<{ id: string }>();

  return result.results.map((row, index) => rankedLaneRow(
    "exact",
    row.id,
    index,
    courseCode
      ? `Exact course code lookup for ${courseCode}.`
      : `Exact CRN lookup for ${filters.crn}.`,
    { matchedTerms: [exactTerm] },
  ));
}

async function titleKeywordSearch(
  db: D1Database,
  keywordQuery: string,
  filters: SearchFilters,
  limit: number = 20,
  scope: SearchScope = "all",
): Promise<RetrievalLaneResult[]> {
  const titleNeedle = keywordQuery.replace(/"/g, "").toLowerCase().trim();
  if (!titleNeedle) return [];

  const filtered = buildFilteredCourseQuery(filters, scope);
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
): Promise<RetrievalLaneResult[]> {
  const { filters, keywordQuery, cleanKeywordQuery, titleQuery, scope } = input;
  if (!keywordQuery.trim()) return [];

  const filtered = buildFilteredCourseQuery(filters, scope);
  const titleResults = titleQuery
    ? await titleKeywordSearch(db, titleQuery, filters, limit, scope)
    : [];
  const ftsMatchCondition = "courses_fts MATCH ?";

  const sql = `
    SELECT DISTINCT c.id, bm25(courses_fts, 10.0, 10.0, 2.0, 0.5, 1.0, 1.0) as fts_score
    FROM courses_fts fts
    JOIN courses c ON c.rowid = fts.rowid
    ${filtered.joinSql}
    ${filtered.whereSql([ftsMatchCondition])}
    ORDER BY fts_score ASC
    LIMIT ?
  `;

  const result = await db.prepare(sql)
    .bind(...filtered.bindParams([cleanKeywordQuery], [limit]))
    .all<{ id: string; fts_score: number }>();

  const ftsResults = result.results.map((row, index) => rankedLaneRow(
    "official_text",
    row.id,
    index,
    "Official course text FTS recall.",
    {
      rawScore: row.fts_score,
      matchedTerms: [cleanKeywordQuery],
    },
  ));
  if (titleResults.length === 0) {
    return ftsResults;
  }

  const seen = new Set<string>();
  const combined: RetrievalLaneResult[] = [];
  for (const row of [...titleResults, ...ftsResults]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    combined.push({ ...row, rank: combined.length + 1 });
    if (combined.length >= limit) break;
  }

  return combined;
}
