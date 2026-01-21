import type { D1Database, VectorizeIndex, Ai } from '@cloudflare/workers-types';
import { searchCourses as semanticSearch } from './embeddings.js';
import type { Course } from '../db/index.js';
import type { SearchPlan } from '@uiuc-course-search/query-types';

export interface SearchResult {
  course: Course;
  score: number;
  semanticRank?: number;
  keywordRank?: number;
}

// Reciprocal Rank Fusion constant
const RRF_K = 60;

function rrfScore(rank: number): number {
  return 1 / (RRF_K + rank);
}

export async function keywordSearch(
  db: D1Database,
  plan: SearchPlan,
  limit: number = 50
): Promise<{ id: string; rank: number }[]> {
  const { filters, keywordQuery } = plan;

  // Fast path: exact course lookup (subject + number)
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
      return exactResult.results.map((r, i) => ({ id: r.id, rank: i + 1 }));
    }
  }

  // CRN direct lookup
  if (filters.crn) {
    const crnSql = `
      SELECT DISTINCT c.id
      FROM sections s
      JOIN courses c ON s.course_id = c.id
      WHERE s.crn = ?
      LIMIT 1
    `;
    const crnResult = await db.prepare(crnSql).bind(filters.crn).all<{ id: string }>();
    if (crnResult.results.length > 0) {
      return crnResult.results.map((r, i) => ({ id: r.id, rank: i + 1 }));
    }
  }

  // Build WHERE clause for filters
  const whereClauses: string[] = [];
  const params: (string | number)[] = [];
  const joins: string[] = [];

  if (filters.subject) {
    whereClauses.push('c.subject = ?');
    params.push(filters.subject);
  }

  if (filters.number) {
    whereClauses.push('c.number = ?');
    params.push(filters.number);
  }

  if (filters.credits !== undefined) {
    whereClauses.push('c.credit_hours = ?');
    params.push(filters.credits);
  }

  if (filters.gened_code) {
    joins.push('JOIN course_gened cg ON cg.course_id = c.id');
    whereClauses.push('(cg.category_id = ? OR cg.attribute_code = ?)');
    params.push(filters.gened_code, filters.gened_code);
  }

  if (filters.instructor_ids && filters.instructor_ids.length > 0) {
    joins.push('JOIN sections s ON s.course_id = c.id');
    joins.push('JOIN meetings m ON m.section_crn = s.crn');
    joins.push('JOIN meeting_instructors mi ON mi.meeting_id = m.id');

    const placeholders = filters.instructor_ids.map(() => '?').join(',');
    whereClauses.push(`mi.instructor_id IN (${placeholders})`);
    params.push(...filters.instructor_ids);
  }

  const whereClause = whereClauses.length > 0
    ? 'WHERE ' + whereClauses.join(' AND ')
    : '';

  const joinClause = joins.join(' ');

  // FTS5 search with BM25 ranking
  const hasKeyword = keywordQuery && keywordQuery.trim().length > 0;

  const sql = hasKeyword ? `
    SELECT DISTINCT c.id, bm25(courses_fts) as fts_score
    FROM courses_fts fts
    JOIN courses c ON c.rowid = fts.rowid
    ${joinClause}
    ${whereClause}
    ${whereClause ? 'AND' : 'WHERE'} courses_fts MATCH ?
    ORDER BY fts_score
    LIMIT ?
  ` : `
    SELECT DISTINCT c.id, 0 as fts_score
    FROM courses c
    ${joinClause}
    ${whereClause}
    ORDER BY c.year DESC, c.subject, c.number
    LIMIT ?
  `;

  const finalParams = [...params];
  if (hasKeyword) {
    const escapedQuery = keywordQuery.replace(/['"]/g, '').trim();
    finalParams.push(escapedQuery);
  }
  finalParams.push(limit);

  const result = await db.prepare(sql).bind(...finalParams).all<{ id: string; fts_score: number }>();

  return result.results.map((r, i) => ({ id: r.id, rank: i + 1 }));
}

export async function sectionKeywordSearch(
  db: D1Database,
  keywordQuery: string,
  limit: number = 50
): Promise<{ id: string; rank: number }[]> {
  if (!keywordQuery || !keywordQuery.trim()) {
    return [];
  }

  const sql = `
    SELECT DISTINCT c.id, bm25(sections_fts) as fts_score
    FROM sections_fts fts
    JOIN sections s ON s.rowid = fts.rowid
    JOIN courses c ON s.course_id = c.id
    WHERE sections_fts MATCH ?
    ORDER BY fts_score
    LIMIT ?
  `;

  const escapedQuery = keywordQuery.replace(/['"]/g, '').trim();
  const result = await db.prepare(sql).bind(escapedQuery, limit).all<{ id: string; fts_score: number }>();

  return result.results.map((r, i) => ({ id: r.id, rank: i + 1 }));
}

export async function hybridSearch(
  db: D1Database,
  vectorize: VectorizeIndex,
  ai: Ai,
  plan: SearchPlan,
  limit: number = 20
): Promise<SearchResult[]> {
  // Run all searches in parallel
  const [semanticResults, courseKeywordResults, sectionKeywordResults] = await Promise.all([
    semanticSearch(vectorize, ai, plan.semanticQuery, 50),
    keywordSearch(db, plan, 50),
    sectionKeywordSearch(db, plan.keywordQuery || plan.semanticQuery, 50)
  ]);

  // Build rank maps
  const semanticRanks = new Map<string, number>();
  semanticResults.forEach((r, i) => semanticRanks.set(r.id, i + 1));

  const keywordRanks = new Map<string, number>();
  courseKeywordResults.forEach((r) => keywordRanks.set(r.id, r.rank));

  // Merge section results into keyword ranks (take best rank if duplicate)
  sectionKeywordResults.forEach((r) => {
    const existing = keywordRanks.get(r.id);
    if (!existing || r.rank < existing) {
      keywordRanks.set(r.id, r.rank);
    }
  });

  // Collect all unique IDs
  const allIds = new Set([...semanticRanks.keys(), ...keywordRanks.keys()]);

  // Calculate RRF scores
  const scores: { id: string; score: number; semanticRank?: number; keywordRank?: number }[] = [];

  for (const id of allIds) {
    let score = 0;
    const semanticRank = semanticRanks.get(id);
    const keywordRank = keywordRanks.get(id);

    if (semanticRank) {
      score += rrfScore(semanticRank);
    }
    if (keywordRank) {
      score += rrfScore(keywordRank);
    }

    scores.push({ id, score, semanticRank, keywordRank });
  }

  // Sort by RRF score and take top results
  scores.sort((a, b) => b.score - a.score);
  const topIds = scores.slice(0, limit);

  if (topIds.length === 0) {
    return [];
  }

  // Fetch full course data
  const placeholders = topIds.map(() => '?').join(',');
  const coursesResult = await db.prepare(`
    SELECT * FROM courses WHERE id IN (${placeholders})
  `).bind(...topIds.map(s => s.id)).all<Course>();

  const courseMap = new Map<string, Course>();
  coursesResult.results.forEach(c => courseMap.set(c.id, c));

  // Return results with scores
  return topIds.map(s => ({
    course: courseMap.get(s.id)!,
    score: s.score,
    semanticRank: s.semanticRank,
    keywordRank: s.keywordRank
  })).filter(r => r.course);
}
