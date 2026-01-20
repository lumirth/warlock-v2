import type { D1Database, VectorizeIndex, Ai } from '@cloudflare/workers-types';
import { searchCourses as semanticSearch } from './embeddings.js';
import type { Course } from '../db/index.js';

export interface SearchFilters {
  subject?: string;
  minGpa?: number;
  maxGpa?: number;
  credits?: number;
  gened?: string;
  status?: string;
  minStartTime?: string;
  maxStartTime?: string;
}

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
  query: string,
  filters: SearchFilters,
  limit: number = 50
): Promise<{ id: string; rank: number }[]> {
  // Build WHERE clause for filters
  const whereClauses: string[] = [];
  const params: (string | number)[] = [];

  if (filters.subject) {
    whereClauses.push('c.subject = ?');
    params.push(filters.subject);
  }
  if (filters.minGpa !== undefined) {
    whereClauses.push('c.avg_gpa >= ?');
    params.push(filters.minGpa);
  }
  if (filters.maxGpa !== undefined) {
    whereClauses.push('c.avg_gpa <= ?');
    params.push(filters.maxGpa);
  }
  if (filters.credits !== undefined) {
    whereClauses.push('c.credit_hours = ?');
    params.push(filters.credits);
  }
  if (filters.gened) {
    whereClauses.push('c.gened = ?');
    params.push(filters.gened);
  }

  const whereClause = whereClauses.length > 0
    ? 'WHERE ' + whereClauses.join(' AND ')
    : '';

  // FTS5 search with BM25 ranking
  const sql = `
    SELECT c.id, bm25(courses_fts) as score
    FROM courses_fts fts
    JOIN courses c ON c.rowid = fts.rowid
    ${whereClause}
    ${query ? "AND courses_fts MATCH ?" : ""}
    ORDER BY score
    LIMIT ?
  `;

  const finalParams = [...params];
  if (query) {
    // Escape special FTS5 characters and use phrase matching
    const escapedQuery = query.replace(/['"]/g, '').trim();
    finalParams.push(escapedQuery);
  }
  finalParams.push(limit);

  const result = await db.prepare(sql).bind(...finalParams).all<{ id: string; score: number }>();

  return result.results.map((r, i) => ({ id: r.id, rank: i + 1 }));
}

export async function hybridSearch(
  db: D1Database,
  vectorize: VectorizeIndex,
  ai: Ai,
  query: string,
  filters: SearchFilters,
  limit: number = 20
): Promise<SearchResult[]> {
  // Run both searches in parallel
  const [semanticResults, keywordResults] = await Promise.all([
    semanticSearch(vectorize, ai, query, 50),
    keywordSearch(db, query, filters, 50)
  ]);

  // Build rank maps
  const semanticRanks = new Map<string, number>();
  semanticResults.forEach((r, i) => semanticRanks.set(r.id, i + 1));

  const keywordRanks = new Map<string, number>();
  keywordResults.forEach((r) => keywordRanks.set(r.id, r.rank));

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
