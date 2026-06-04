import type { D1Database } from "@cloudflare/workers-types";
import { hasRequirementFilter } from "@uiuc-course-search/query-types";
import type { RetrievalLane, SearchFilters, SearchPlan } from "./search-planner-types.js";
import { buildFilterClauses } from "./search-filters.js";
import type { RankedLaneRow, WorkloadLaneRow } from "./search-fusion.js";
import { chunkValues } from "./search-loaders.js";
import { escapeLike, sanitizeFtsQuery, titleLaneQuery } from "./search-text.js";

function rankedLaneRow(
  lane: RetrievalLane,
  id: string,
  index: number,
  reason: string,
  options: {
    rawScore?: number | null;
    matchedTerms?: string[];
    evidence?: string[];
  } = {},
): RankedLaneRow {
  return {
    id,
    lane,
    rank: index + 1,
    reason,
    rawScore: options.rawScore ?? undefined,
    matchedTerms: options.matchedTerms,
    evidence: options.evidence,
  };
}

export async function titleKeywordSearch(
  db: D1Database,
  keywordQuery: string,
  filters: SearchFilters,
  limit: number = 20,
): Promise<RankedLaneRow[]> {
  const titleNeedle = keywordQuery.replace(/"/g, "").toLowerCase().trim();
  if (!titleNeedle) return [];

  const filterResults = buildFilterClauses(filters);
  const { joins, where, params, having, havingParams } = filterResults;
  const titlePrefix = `${escapeLike(titleNeedle)}%`;
  const titleContains = `%${escapeLike(titleNeedle)}%`;
  const titleWhere = "LOWER(c.title) LIKE ? ESCAPE '\\'";
  const whereClause = where.length > 0
    ? `WHERE ${where.join(" AND ")} AND ${titleWhere}`
    : `WHERE ${titleWhere}`;

  const sql = `
    SELECT c.id,
      MIN(CASE
        WHEN LOWER(c.title) = ? THEN 1
        WHEN LOWER(c.title) LIKE ? ESCAPE '\\' THEN 2
        ELSE 3
      END) as title_rank
    FROM courses c
    ${joins.join(" ")}
    ${whereClause}
    GROUP BY c.id
    ${having ? "HAVING " + having : ""}
    ORDER BY title_rank ASC,
      c.year DESC,
      CASE c.term WHEN 'fall' THEN 1 WHEN 'spring' THEN 2 WHEN 'summer' THEN 3 ELSE 4 END,
      c.subject,
      c.number
    LIMIT ?
  `;

  const result = await db.prepare(sql)
    .bind(titleNeedle, titlePrefix, ...params, titleContains, ...(havingParams ?? []), limit)
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
  plan: SearchPlan,
  limit: number = 50,
): Promise<RankedLaneRow[]> {
  const { filters, keywordQuery } = plan;

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

  const filterResults = buildFilterClauses(filters);
  const { joins, where, params } = filterResults;

  const whereClause = where.length > 0
    ? "WHERE " + where.join(" AND ")
    : "";
  const joinClause = joins.join(" ");
  const hasKeyword = keywordQuery && keywordQuery.trim().length > 0;
  const cleanQuery = hasKeyword ? sanitizeFtsQuery(keywordQuery) : "";
  const titleQuery = hasKeyword ? titleLaneQuery(plan, cleanQuery) : "";
  const titleResults = hasKeyword
    ? await titleKeywordSearch(db, titleQuery, filters, limit)
    : [];
  const finalParams = hasKeyword
    ? [...params, cleanQuery, limit]
    : [...params, limit];

  const sql = hasKeyword ? `
    SELECT DISTINCT c.id, bm25(courses_fts, 10.0, 10.0, 2.0, 0.5, 1.0, 1.0) as fts_score
    FROM courses_fts fts
    JOIN courses c ON c.rowid = fts.rowid
    ${joinClause}
    ${whereClause}
    ${whereClause ? "AND" : "WHERE"} courses_fts MATCH ?
    ORDER BY fts_score ASC
    LIMIT ?
  ` : `
    SELECT DISTINCT c.id, 0 as fts_score
    FROM courses c
    ${joinClause}
    ${whereClause}
    ORDER BY c.year DESC, c.subject, c.number
    LIMIT ?
  `;

  const result = await db.prepare(sql)
    .bind(...finalParams)
    .all<{ id: string; fts_score: number }>();

  const ftsResults = result.results.map((row, index) => rankedLaneRow(
    "official_text",
    row.id,
    index,
    hasKeyword ? "Official course text FTS recall." : "Structured course-filter recall.",
    {
      rawScore: row.fts_score,
      matchedTerms: hasKeyword ? [cleanQuery] : undefined,
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

export async function sectionKeywordSearch(
  db: D1Database,
  keywordQuery: string,
  filters: SearchFilters,
  limit: number = 50,
): Promise<RankedLaneRow[]> {
  if (!keywordQuery || !keywordQuery.trim()) {
    return [];
  }

  const filterResults = buildFilterClauses(filters);
  const { joins, where, params } = filterResults;
  const whereClause = where.length > 0
    ? "WHERE " + where.join(" AND ")
    : "";
  const uniqueJoins = joins.filter(join => !join.includes("JOIN sections s "));
  const joinClause = uniqueJoins.join(" ");

  const sql = `
    SELECT DISTINCT c.id, bm25(sections_fts) as fts_score
    FROM sections_fts fts
    JOIN sections s ON s.rowid = fts.rowid
    JOIN courses c ON s.course_id = c.id
    ${joinClause}
    ${whereClause}
    ${whereClause ? "AND" : "WHERE"} sections_fts MATCH ?
    ORDER BY fts_score ASC
    LIMIT ?
  `;

  const escapedQuery = sanitizeFtsQuery(keywordQuery);
  const result = await db.prepare(sql)
    .bind(...params, escapedQuery, limit)
    .all<{ id: string; fts_score: number }>();

  return result.results.map((row, index) => rankedLaneRow(
    "section_text",
    row.id,
    index,
    "Section text FTS recall.",
    { rawScore: row.fts_score, matchedTerms: [escapedQuery] },
  ));
}

export async function requirementLaneSearch(
  db: D1Database,
  plan: SearchPlan,
  limit: number = 50,
): Promise<RankedLaneRow[]> {
  const hasFilter = hasRequirementFilter(plan.filters);

  if (!hasFilter) {
    return [];
  }

  const filterResults = buildFilterClauses(plan.filters);
  const { joins, where, params, groupBy, having, havingParams } = filterResults;

  if (where.length === 0 && joins.length === 0) {
    return [];
  }

  const sql = `
    SELECT DISTINCT c.id
    FROM courses c
    ${joins.join(" ")}
    ${where.length > 0 ? "WHERE " + where.join(" AND ") : ""}
    ${groupBy ? "GROUP BY " + groupBy : ""}
    ${having ? "HAVING " + having : ""}
    ORDER BY c.year DESC, c.subject, c.number
    LIMIT ?
  `;

  const result = await db.prepare(sql)
    .bind(...params, ...(havingParams ?? []), limit)
    .all<{ id: string }>();

  return result.results.map((row, index) => rankedLaneRow(
    "requirement",
    row.id,
    index,
    "Structured requirement mapping recall.",
  ));
}

export async function structuredSectionLaneSearch(
  db: D1Database,
  plan: SearchPlan,
  limit: number = 50,
): Promise<RankedLaneRow[]> {
  const hasSectionFilter = Boolean(
    plan.filters.online !== undefined
    || plan.filters.days
    || plan.filters.time
    || plan.filters.status
    || plan.filters.partOfTerm,
  );
  const hasSectionPreference = Boolean(
    plan.softPreferences?.startAfterMinutes
    || plan.softPreferences?.startBeforeMinutes
    || plan.softPreferences?.compressedTerm
    || plan.softPreferences?.asyncFriendly,
  );

  if (!hasSectionFilter && !hasSectionPreference) {
    return [];
  }

  const filterResults = buildFilterClauses(plan.filters);
  const { joins, where, params, groupBy, having, havingParams } = filterResults;
  if (joins.length === 0 && where.length === 0) {
    return [];
  }

  const sql = `
    SELECT DISTINCT c.id
    FROM courses c
    ${joins.join(" ")}
    ${where.length > 0 ? "WHERE " + where.join(" AND ") : ""}
    ${groupBy ? "GROUP BY " + groupBy : ""}
    ${having ? "HAVING " + having : ""}
    ORDER BY c.year DESC, c.subject, c.number
    LIMIT ?
  `;

  const result = await db.prepare(sql)
    .bind(...params, ...(havingParams ?? []), limit)
    .all<{ id: string }>();

  return result.results.map((row, index) => rankedLaneRow(
    "structured_section",
    row.id,
    index,
    "Structured section constraint recall.",
  ));
}

export async function studentAliasLaneSearch(
  db: D1Database,
  plan: SearchPlan,
  limit: number = 50,
  plannedAliasQuery?: string,
): Promise<RankedLaneRow[]> {
  const aliasQuery = plannedAliasQuery ?? buildAliasLaneQuery(plan);
  if (!aliasQuery) {
    return [];
  }

  const filterResults = buildFilterClauses(plan.filters);
  const { joins, where, params, groupBy, having, havingParams } = filterResults;
  const whereClause = where.length > 0 ? "WHERE " + where.join(" AND ") : "";
  const joinClause = joins.join(" ");

  const sql = `
    SELECT DISTINCT c.id, bm25(course_aliases_fts) as fts_score
    FROM course_aliases_fts fts
    JOIN course_aliases ca ON ca.rowid = fts.rowid
    JOIN courses c ON c.id = ca.course_id
    ${joinClause}
    ${whereClause}
    ${whereClause ? "AND" : "WHERE"} course_aliases_fts MATCH ?
    ${groupBy ? "GROUP BY " + groupBy : ""}
    ${having ? "HAVING " + having : ""}
    ORDER BY fts_score ASC
    LIMIT ?
  `;

  const result = await db.prepare(sql)
    .bind(...params, aliasQuery, ...(havingParams ?? []), limit)
    .all<{ id: string; fts_score: number }>();

  return result.results.map((row, index) => rankedLaneRow(
    "student_language_alias",
    row.id,
    index,
    "Student-language alias FTS recall.",
    { rawScore: row.fts_score, matchedTerms: [aliasQuery] },
  ));
}

export async function workloadEvidenceLaneSearch(
  db: D1Database,
  plan: SearchPlan,
  limit: number = 50,
  plannedSignalTypes?: string[],
): Promise<WorkloadLaneRow[]> {
  const signalTypes = plannedSignalTypes ?? workloadSignalTypes(plan);
  if (signalTypes.length === 0) {
    return [];
  }

  const filterResults = buildFilterClauses(plan.filters);
  const { joins, where, params, groupBy, having, havingParams } = filterResults;
  const signalPlaceholders = signalTypes.map(() => "?").join(",");
  const whereParts = [`cs.signal_type IN (${signalPlaceholders})`, ...where];

  const sql = `
    SELECT c.id,
      GROUP_CONCAT(DISTINCT cs.signal_type) as claims,
      MAX(COALESCE(cs.confidence, 0) * COALESCE(cs.value, 0)) as evidence_score
    FROM course_signals cs
    JOIN courses c ON c.id = cs.course_id
    ${joins.join(" ")}
    WHERE ${whereParts.join(" AND ")}
    ${groupBy ? "GROUP BY " + groupBy + ", c.id" : "GROUP BY c.id"}
    ${having ? "HAVING " + having : ""}
    ORDER BY evidence_score DESC, c.year DESC, c.subject, c.number
    LIMIT ?
  `;

  const result = await db.prepare(sql)
    .bind(...signalTypes, ...params, ...(havingParams ?? []), limit)
    .all<{ id: string; claims: string | null; evidence_score: number | null }>();

  return result.results.map((row, index) => {
    const claims = row.claims?.split(",").filter(Boolean) ?? [];
    return {
      ...rankedLaneRow(
        "workload_evidence",
        row.id,
        index,
        "Structured workload or subjective evidence recall.",
        {
          rawScore: row.evidence_score,
          matchedTerms: signalTypes,
          evidence: claims,
        },
      ),
      claims,
    };
  });
}

export async function postFilterSemanticResults(
  db: D1Database,
  semanticResults: { id: string; score: number }[],
  filters: SearchFilters,
): Promise<{ id: string; score: number }[]> {
  if (semanticResults.length === 0) return [];

  const hasActiveFilters = Object.values(filters)
    .some(value => value !== undefined && value !== null && (Array.isArray(value) ? value.length > 0 : true));
  if (!hasActiveFilters) return semanticResults;

  const { joins, where, params, groupBy, having, havingParams } = buildFilterClauses(filters);

  if (where.length === 0 && joins.length === 0 && !having) return semanticResults;

  const courseIds = semanticResults.map(row => row.id);
  const validIdSet = new Set<string>();

  for (const batch of chunkValues(courseIds, 50)) {
    const placeholders = batch.map(() => "?").join(",");

    const sql = `
      SELECT c.id
      FROM courses c
      ${joins.join(" ")}
      WHERE c.id IN (${placeholders})
      ${where.length > 0 ? "AND " + where.join(" AND ") : ""}
      ${groupBy ? "GROUP BY " + groupBy : ""}
      ${having ? "HAVING " + having : ""}
    `;

    const finalParams = [...batch, ...params, ...(havingParams || [])];
    const validIdsResult = await db.prepare(sql)
      .bind(...finalParams)
      .all<{ id: string }>();
    for (const row of validIdsResult.results) {
      validIdSet.add(row.id);
    }
  }

  return semanticResults.filter(row => validIdSet.has(row.id));
}

export function buildAliasLaneQuery(plan: SearchPlan): string {
  const terms = new Set<string>();
  for (const value of [plan.keywordQuery, plan.semanticQuery]) {
    if (value?.trim()) terms.add(value.trim());
  }
  for (const value of plan.rescue?.topicTerms ?? []) terms.add(value);
  for (const value of plan.rescue?.expandedTerms ?? []) terms.add(value);
  for (const value of plan.rescue?.negativeTerms ?? []) {
    terms.add(value.replace(/_/g, " "));
  }
  for (const assumption of plan.rescue?.assumptions ?? []) {
    terms.add(assumption.kind.replace(/_/g, " "));
    terms.add(assumption.label);
  }

  const sanitizedTerms = Array.from(terms)
    .map(term => sanitizeFtsQuery(term))
    .filter(Boolean)
    .slice(0, 12);

  return sanitizedTerms.length > 0 ? sanitizedTerms.join(" OR ") : "";
}

export function workloadSignalTypes(plan: SearchPlan): string[] {
  const types = new Set<string>();
  const soft = plan.softPreferences ?? {};

  if (soft.lowWorkload || plan.filters.difficulty === "easy") {
    ["low_workload", "high_avg_gpa", "non_major_friendly"].forEach(type => types.add(type));
  }
  if (soft.lowWriting) {
    ["low_writing", "writing_light", "few_papers"].forEach(type => types.add(type));
  }
  if (soft.lowReading) {
    ["low_reading", "reading_light"].forEach(type => types.add(type));
  }
  if (soft.lowExams) {
    ["low_exams", "low_exam", "quiz_based"].forEach(type => types.add(type));
  }
  if (soft.lowMath) {
    ["low_math", "non_quantitative", "non_major_friendly"].forEach(type => types.add(type));
  }
  if (soft.noListedPrereq) {
    ["no_listed_prereq", "non_major_friendly"].forEach(type => types.add(type));
  }
  if (soft.fun) {
    types.add("interesting_topic");
  }

  return Array.from(types);
}
