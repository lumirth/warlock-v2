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
import { rankedLaneRow } from "./search-retrieval-lane-result.js";
import { escapeLike } from "./search-text.js";
import type { RetrievalLaneResult } from "./search-types.js";
import { courseSqlOrderBy } from "./search-sql-sort.js";

type CourseKeywordLaneInput = {
  filters: SearchFilters;
  keywordQuery: string;
  cleanKeywordQuery: string;
  titleQuery: string;
  scope: SearchScope;
  sort: SearchSort;
};

export function buildFilteredCourseCandidateQuery(
  filters: SearchFilters,
  scope: SearchScope = "all",
): CandidateSqlQuery {
  const filtered = buildFilteredCourseQuery(filters, scope);
  return {
    sql: `
      SELECT DISTINCT c.id
      FROM courses c
      ${filtered.joinSql}
      ${filtered.whereSql()}
      ${filtered.groupBySql("c.id")}
    `,
    params: filtered.bindParams(),
  };
}

export async function structuredCourseSearch(
  db: D1Database,
  filters: SearchFilters,
  limit: number = 50,
  scope: SearchScope = "all",
  sort: SearchSort = DEFAULT_SEARCH_SORT,
): Promise<RetrievalLaneResult[]> {
  const candidateQuery = buildFilteredCourseCandidateQuery(filters, scope);
  const result = await db.prepare(`
    SELECT candidates.id
    FROM (${candidateQuery.sql}) candidates
    JOIN courses c ON c.id = candidates.id
    ORDER BY ${courseSqlOrderBy(sort, "c.year DESC, c.subject, c.number")}
    LIMIT ?
  `)
    .bind(...candidateQuery.params, limit)
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
  sort: SearchSort = DEFAULT_SEARCH_SORT,
): Promise<RetrievalLaneResult[]> {
  const courseCode = filters.subject && filters.number
    ? `${filters.subject} ${filters.number}`
    : null;
  const exactTerm = courseCode ?? filters.crn;
  if (!exactTerm) return [];

  const candidateQuery = buildFilteredCourseCandidateQuery(filters, scope);
  const result = await db.prepare(`
    SELECT candidates.id
    FROM (${candidateQuery.sql}) candidates
    JOIN courses c ON c.id = candidates.id
    ORDER BY ${courseSqlOrderBy(
      sort,
      "c.year DESC, CASE c.term WHEN 'spring' THEN 1 WHEN 'fall' THEN 2 WHEN 'summer' THEN 3 ELSE 4 END",
    )}
    LIMIT ?
  `)
    .bind(...candidateQuery.params, limit)
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

export function buildTitleCandidateQuery(
  titleQuery: string,
  filters: SearchFilters,
  scope: SearchScope = "all",
): CandidateSqlQuery | null {
  const titleNeedle = titleQuery.replace(/"/g, "").toLowerCase().trim();
  if (!titleNeedle) return null;

  const filtered = buildFilteredCourseQuery(filters, scope);
  const titlePrefix = `${escapeLike(titleNeedle)}%`;
  const titleContains = `%${escapeLike(titleNeedle)}%`;
  return {
    sql: `
      SELECT c.id,
        MIN(CASE
          WHEN LOWER(c.title) = ? THEN 1
          WHEN LOWER(c.title) LIKE ? ESCAPE '\\' THEN 2
          ELSE 3
        END) as title_rank
      FROM courses c
      ${filtered.joinSql}
      ${filtered.whereSql(["LOWER(c.title) LIKE ? ESCAPE '\\'"])}
      ${filtered.groupBySql("c.id")}
    `,
    params: [
      titleNeedle,
      titlePrefix,
      ...filtered.bindParams([titleContains]),
    ],
  };
}

async function titleKeywordSearch(
  db: D1Database,
  titleQuery: string,
  filters: SearchFilters,
  limit: number = 20,
  scope: SearchScope = "all",
  sort: SearchSort = DEFAULT_SEARCH_SORT,
): Promise<RetrievalLaneResult[]> {
  const candidateQuery = buildTitleCandidateQuery(titleQuery, filters, scope);
  if (!candidateQuery) return [];
  const titleNeedle = titleQuery.replace(/"/g, "").toLowerCase().trim();

  const result = await db.prepare(`
    SELECT candidates.id, candidates.title_rank
    FROM (${candidateQuery.sql}) candidates
    JOIN courses c ON c.id = candidates.id
    ORDER BY ${courseSqlOrderBy(
      sort,
      "title_rank ASC, c.year DESC, CASE c.term WHEN 'fall' THEN 1 WHEN 'spring' THEN 2 WHEN 'summer' THEN 3 ELSE 4 END, c.subject, c.number",
    )}
    LIMIT ?
  `)
    .bind(...candidateQuery.params, limit)
    .all<{ id: string; title_rank: number }>();

  return result.results.map((row, index) => rankedLaneRow(
    "official_text",
    row.id,
    index,
    row.title_rank === 1 ? "Exact title recall." : "Title prefix or contains recall.",
    { rawScore: row.title_rank, matchedTerms: [titleNeedle] },
  ));
}

export function buildCourseFtsCandidateQuery(
  cleanKeywordQuery: string,
  filters: SearchFilters,
  scope: SearchScope = "all",
): CandidateSqlQuery | null {
  if (!cleanKeywordQuery.trim()) return null;

  const filtered = buildFilteredCourseQuery(filters, scope);
  return {
    sql: `
      SELECT DISTINCT c.id,
        bm25(courses_fts, 10.0, 10.0, 2.0, 0.5, 1.0, 1.0) as fts_score
      FROM courses_fts fts
      JOIN courses c ON c.rowid = fts.rowid
      ${filtered.joinSql}
      ${filtered.whereSql(["courses_fts MATCH ?"])}
    `,
    params: filtered.bindParams([cleanKeywordQuery]),
  };
}

export async function keywordSearch(
  db: D1Database,
  input: CourseKeywordLaneInput,
  limit: number = 50,
): Promise<RetrievalLaneResult[]> {
  const { filters, keywordQuery, cleanKeywordQuery, titleQuery, scope } = input;
  if (!keywordQuery.trim()) return [];

  const titleCandidateQuery = titleQuery
    ? buildTitleCandidateQuery(titleQuery, filters, scope)
    : null;
  const ftsCandidateQuery = buildCourseFtsCandidateQuery(
    cleanKeywordQuery,
    filters,
    scope,
  );

  if (!ftsCandidateQuery) {
    return titleQuery
      ? titleKeywordSearch(db, titleQuery, filters, limit, scope, input.sort)
      : [];
  }

  if (!titleCandidateQuery) {
    const result = await db.prepare(`
      SELECT candidates.id, candidates.fts_score
      FROM (${ftsCandidateQuery.sql}) candidates
      JOIN courses c ON c.id = candidates.id
      ORDER BY ${courseSqlOrderBy(input.sort, "fts_score ASC")}
      LIMIT ?
    `)
      .bind(...ftsCandidateQuery.params, limit)
      .all<{ id: string; fts_score: number }>();

    return result.results.map((row, index) => rankedLaneRow(
      "official_text",
      row.id,
      index,
      "Official course text FTS recall.",
      {
        rawScore: row.fts_score,
        matchedTerms: [cleanKeywordQuery],
      },
    ));
  }

  const titleNeedle = titleQuery.replace(/"/g, "").toLowerCase().trim();
  const result = await db.prepare(`
    SELECT
      candidates.id,
      MIN(candidates.title_rank) AS title_rank,
      MIN(candidates.fts_score) AS fts_score
    FROM (
      SELECT title_candidates.id, title_candidates.title_rank, NULL AS fts_score
      FROM (${titleCandidateQuery.sql}) title_candidates
      UNION ALL
      SELECT fts_candidates.id, NULL AS title_rank, fts_candidates.fts_score
      FROM (${ftsCandidateQuery.sql}) fts_candidates
    ) candidates
    JOIN courses c ON c.id = candidates.id
    GROUP BY candidates.id
    ORDER BY ${courseSqlOrderBy(
      input.sort,
      "CASE WHEN title_rank IS NOT NULL THEN 0 ELSE 1 END ASC, title_rank ASC, fts_score ASC, c.year DESC, c.subject, c.number",
    )}
    LIMIT ?
  `)
    .bind(
      ...titleCandidateQuery.params,
      ...ftsCandidateQuery.params,
      limit,
    )
    .all<{
      id: string;
      title_rank: number | null;
      fts_score: number | null;
    }>();

  return result.results.map((row, index) => {
    const titleMatched = row.title_rank !== null;
    return rankedLaneRow(
      "official_text",
      row.id,
      index,
      titleMatched
        ? row.title_rank === 1
          ? "Exact title recall."
          : "Title prefix or contains recall."
        : "Official course text FTS recall.",
      {
        rawScore: row.title_rank ?? row.fts_score ?? undefined,
        matchedTerms: [titleMatched ? titleNeedle : cleanKeywordQuery],
      },
    );
  });
}
