import type { D1Database, VectorizeIndex, Ai } from '@cloudflare/workers-types';
import { searchCourses as semanticSearch } from './embeddings.js';
import { validateSubject } from './query-resolver.js';
import type { Course } from '../db/index.js';
import type { SearchPlan, SearchFilters } from '@uiuc-course-search/query-types';

export interface SearchResult {
  course: Course;
  score: number;
  semanticRank?: number;
  keywordRank?: number;
  termPriority?: number;
  historical?: boolean;
}

export const TIME_RANGES: Record<string, { start?: string; end?: string }> = {
  'early': { end: '09:00' },
  'morning': { end: '12:00' },
  'midday': { start: '10:00', end: '14:00' },
  'afternoon': { start: '12:00', end: '17:00' },
  'evening': { start: '17:00' },
};

export const DIFFICULTY_THRESHOLDS = {
  easy: { min_gpa: 3.5, max_difficulty: 3.0 },
  hard: { max_gpa: 3.0, min_difficulty: 4.0 },
};

const STATUS_VALUES: Record<string, string[]> = {
  'open': ['Open'],
  'available': ['Open', 'Restricted'],
  'closed': ['Closed'],
};

interface TermInfo {
  term_id: string;
  year: number;
  term: string;
  status: string;
}

function getTermPriority(
  termInfo: TermInfo,
  activeTerm: string | null,
  registrableTerm: string | null
): number {
  const seasonRank: Record<string, number> = { fall: 1, spring: 1, summer: 2, winter: 2 };

  // Registrable term is highest priority
  if (termInfo.term_id === registrableTerm) return 0;

  // Active term is second priority
  if (termInfo.term_id === activeTerm) return 1;

  // Historical: Fall/Spring before Winter/Summer, then by recency
  const base = 100 - termInfo.year;
  const seasonPenalty = (seasonRank[termInfo.term] === 2) ? 50 : 0;

  return 2 + base + seasonPenalty;
}

// Reciprocal Rank Fusion constant
const RRF_K = 60;

function rrfScore(rank: number): number {
  return 1 / (RRF_K + rank);
}

export function applyTitleBoost(
  scores: { id: string; score: number; title?: string }[],
  query: string
): { id: string; score: number; title?: string }[] {
  const queryLower = query.toLowerCase().trim();
  if (!queryLower) return scores;

  return scores.map(item => {
    if (!item.title) return item;

    const titleLower = item.title.toLowerCase();
    let boost = 0;

    if (titleLower === queryLower) {
      boost = 0.5;  // Exact match
    } else if (titleLower.includes(queryLower)) {
      boost = 0.2;  // Query contained in title
    } else if (queryLower.includes(titleLower)) {
      boost = 0.15;  // Title contained in query
    }

    return { ...item, score: item.score + boost };
  }).sort((a, b) => b.score - a.score);
}

export interface FilterClauseResult {
  joins: string[];
  where: string[];
  params: (string | number)[];
  groupBy?: string;
  having?: string;
  havingParams?: (string | number)[];
}

export function buildFilterClauses(
  filters: SearchFilters
): FilterClauseResult {
  const joinsSet = new Set<string>();
  const where: string[] = [];
  const params: (string | number)[] = [];
  let groupBy: string | undefined;
  let having: string | undefined;
  const havingParams: (string | number)[] = [];

  // Subject filter
  if (filters.subject) {
    where.push('c.subject = ?');
    params.push(filters.subject);
  }

  // Number filter
  if (filters.number) {
    where.push('c.number = ?');
    params.push(filters.number);
  }

  // Credits filter
  if (filters.credits !== undefined) {
    where.push('c.credit_hours = ?');
    params.push(filters.credits);
  }

  // Level filter
  if (filters.level !== undefined) {
    where.push('CAST(SUBSTR(c.number, 1, 1) AS INTEGER) * 100 = ?');
    params.push(filters.level);
  }

  // GenEd filter (single)
  if (filters.gened_code) {
    joinsSet.add('JOIN course_gened cg ON cg.course_id = c.id');
    where.push('(cg.category_id = ? OR cg.attribute_code = ?)');
    params.push(filters.gened_code, filters.gened_code);
  }

  // GenEd filter (any)
  if (filters.gened_any?.length) {
    joinsSet.add('JOIN course_gened cg ON cg.course_id = c.id');
    const placeholders = filters.gened_any.map(() => '?').join(',');
    where.push(`cg.category_id IN (${placeholders})`);
    params.push(...filters.gened_any);
  }

  // GenEd filter (all) - requires GROUP BY + HAVING
  if (filters.gened_all?.length) {
    joinsSet.add('JOIN course_gened cg_all ON cg_all.course_id = c.id');
    const placeholders = filters.gened_all.map(() => '?').join(',');
    where.push(`cg_all.category_id IN (${placeholders})`);
    params.push(...filters.gened_all);
    groupBy = 'c.id';
    having = `COUNT(DISTINCT cg_all.category_id) = ?`;
    havingParams.push(filters.gened_all.length);
  }

  // Instructor filter
  if (filters.instructor_ids?.length) {
    joinsSet.add('JOIN sections s ON s.course_id = c.id');
    joinsSet.add('JOIN meetings m ON m.section_crn = s.crn');
    joinsSet.add('JOIN meeting_instructors mi ON mi.meeting_id = m.id');
    const placeholders = filters.instructor_ids.map(() => '?').join(',');
    where.push(`mi.instructor_id IN (${placeholders})`);
    params.push(...filters.instructor_ids);
  }

  // Days filter
  if (filters.days) {
    joinsSet.add('JOIN sections s ON s.course_id = c.id');
    joinsSet.add('JOIN meetings m ON m.section_crn = s.crn');
    where.push('m.days = ?');
    params.push(filters.days);
  }

  // Time filter
  if (filters.time) {
    const range = TIME_RANGES[filters.time];
    if (range) {
      joinsSet.add('JOIN sections s ON s.course_id = c.id');
      joinsSet.add('JOIN meetings m ON m.section_crn = s.crn');
      if (range.start) {
        where.push('m.start_time >= ?');
        params.push(range.start);
      }
      if (range.end) {
        where.push('m.start_time < ?');
        params.push(range.end);
      }
    }
  }

  // Online filter
  if (filters.online !== undefined) {
    joinsSet.add('JOIN sections s ON s.course_id = c.id');
    joinsSet.add('JOIN meetings m ON m.section_crn = s.crn');
    if (filters.online) {
      where.push("(m.building_name = '' OR m.building_name IS NULL OR LOWER(m.building_name) LIKE '%online%')");
    } else {
      where.push("m.building_name != '' AND m.building_name IS NOT NULL AND LOWER(m.building_name) NOT LIKE '%online%'");
    }
  }

  // Status filter
  if (filters.status) {
    joinsSet.add('JOIN sections s ON s.course_id = c.id');
    const statuses = STATUS_VALUES[filters.status] ?? ['Open'];
    const placeholders = statuses.map(() => '?').join(',');
    where.push(`s.status IN (${placeholders})`);
    params.push(...statuses);
  }

  // Difficulty filter
  if (filters.difficulty) {
    const thresholds = DIFFICULTY_THRESHOLDS[filters.difficulty];
    if ('min_gpa' in thresholds) {
      where.push('c.avg_gpa >= ?');
      params.push(thresholds.min_gpa);
    }
    if ('max_gpa' in thresholds) {
      where.push('c.avg_gpa <= ?');
      params.push(thresholds.max_gpa);
    }
    if ('min_difficulty' in thresholds) {
      where.push('c.difficulty_score >= ?');
      params.push(thresholds.min_difficulty);
    }
    if ('max_difficulty' in thresholds) {
      where.push('c.difficulty_score <= ?');
      params.push(thresholds.max_difficulty);
    }
  }

  // Negation filters
  if (filters.not) {
    // Negated time ranges
    if (filters.not.time?.length) {
      joinsSet.add('JOIN sections s ON s.course_id = c.id');
      joinsSet.add('JOIN meetings m ON m.section_crn = s.crn');
      for (const timeNeg of filters.not.time) {
        const range = TIME_RANGES[timeNeg];
        if (range) {
          // Exclude courses that have meetings in this time range
          if (range.start && range.end) {
            where.push('NOT (m.start_time >= ? AND m.start_time < ?)');
            params.push(range.start, range.end);
          } else if (range.end) {
            // "no morning" = exclude if start_time < 12:00
            where.push('m.start_time >= ?');
            params.push(range.end);
          } else if (range.start) {
            // "no evening" = exclude if start_time >= 17:00
            where.push('m.start_time < ?');
            params.push(range.start);
          }
        }
      }
    }

    // Negated days
    if (filters.not.days?.length) {
      joinsSet.add('JOIN sections s ON s.course_id = c.id');
      joinsSet.add('JOIN meetings m ON m.section_crn = s.crn');
      for (const daysNeg of filters.not.days) {
        where.push('m.days != ?');
        params.push(daysNeg);
      }
    }

    // Negated instructors
    if (filters.not.instructor_ids?.length) {
      joinsSet.add('JOIN sections s ON s.course_id = c.id');
      joinsSet.add('JOIN meetings m ON m.section_crn = s.crn');
      joinsSet.add('JOIN meeting_instructors mi ON mi.meeting_id = m.id');
      const placeholders = filters.not.instructor_ids.map(() => '?').join(',');
      where.push(`mi.instructor_id NOT IN (${placeholders})`);
      params.push(...filters.not.instructor_ids);
    }
  }

  return {
    joins: Array.from(joinsSet),
    where,
    params,
    groupBy,
    having,
    havingParams,
  };
}

const SPECIAL_TOKENS: Record<string, string> = {
  'c/c++': 'c cplusplus',
  'c++': 'cplusplus',
  'c#': 'csharp',
  '.net': 'dotnet',
  'f#': 'fsharp',
};

// Pre-compile regex for performance and correctness
// Sort by length descending to handle overlapping tokens correctly
// Use lookarounds to ensure we only match standalone tokens (not inside other words)
const SPECIAL_TOKEN_REGEX = new RegExp(
  Object.keys(SPECIAL_TOKENS)
    .sort((a, b) => b.length - a.length)
    .map(t => {
      // Escape special characters
      const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Apply alphanumeric boundaries to all tokens to ensure we match whole "words"
      // even if they start/end with symbols (like .net or c++)
      return `(?<![a-zA-Z0-9])${escaped}(?![a-zA-Z0-9])`;
    })
    .join('|'),
  'gi'
);

export function sanitizeFtsQuery(query: string): string {
  if (!query) return '';

  // Handle special tokens in a single pass with word boundary safety
  let sanitized = query.replace(SPECIAL_TOKEN_REGEX, (match) => {
    return SPECIAL_TOKENS[match.toLowerCase()] || match;
  });

  // Replace & with " and " to avoid silent failures or syntax errors
  sanitized = sanitized.replace(/&/g, ' and ');

  // Count double quotes to check for balance
  const quoteCount = (sanitized.match(/"/g) || []).length;
  if (quoteCount % 2 !== 0) {
    // Unbalanced quotes - remove them to prevent FTS5 syntax errors
    sanitized = sanitized.replace(/"/g, ' ');
  }

  // Replace special chars that might break FTS5
  // We keep alphanumeric, spaces, and double quotes (if they were balanced)
  // Single quotes are also kept as they are usually fine for tokenizer
  sanitized = sanitized.replace(/[^\w\s"']/g, ' ');

  // Collapse whitespace
  return sanitized.replace(/\s+/g, ' ').trim();
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

  // Build filter clauses using shared utility
  const filterResults = buildFilterClauses(filters);
  const { joins, where, params } = filterResults;

  const whereClause = where.length > 0
    ? 'WHERE ' + where.join(' AND ')
    : '';

  const joinClause = joins.join(' ');

  // FTS5 search with BM25 ranking
  const hasKeyword = keywordQuery && keywordQuery.trim().length > 0;

  // Sanitize the query
  const cleanQuery = hasKeyword ? sanitizeFtsQuery(keywordQuery) : '';
  let searchParam = cleanQuery;

  // Query Expansion: "Computer Science" -> ("Computer Science") OR CS
  if (hasKeyword && !filters.subject && !filters.number) {
    const subjectId = await validateSubject(db, cleanQuery);
    if (subjectId) {
      const escaped = cleanQuery.replace(/"/g, '""');
      searchParam = `"${escaped}" OR ${subjectId}`;
    }
  }

  const sql = hasKeyword ? `
    SELECT DISTINCT c.id, bm25(courses_fts, 10.0, 10.0, 2.0, 0.5, 1.0, 1.0) as fts_score
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
    finalParams.push(searchParam);
  }
  finalParams.push(limit);

  const result = await db.prepare(sql).bind(...finalParams).all<{ id: string; fts_score: number }>();

  return result.results.map((r, i) => ({ id: r.id, rank: i + 1 }));
}

export async function sectionKeywordSearch(
  db: D1Database,
  keywordQuery: string,
  filters: SearchFilters,
  limit: number = 50
): Promise<{ id: string; rank: number }[]> {
  if (!keywordQuery || !keywordQuery.trim()) {
    return [];
  }

  // Build filter clauses using shared utility
  const filterResults = buildFilterClauses(filters);
  const { joins, where, params } = filterResults;

  const whereClause = where.length > 0
    ? 'WHERE ' + where.join(' AND ')
    : '';

  const joinClause = joins.join(' ');

  const sql = `
    SELECT DISTINCT c.id, bm25(sections_fts) as fts_score
    FROM sections_fts fts
    JOIN sections s ON s.rowid = fts.rowid
    JOIN courses c ON s.course_id = c.id
    ${joinClause}
    ${whereClause}
    ${whereClause ? 'AND' : 'WHERE'} sections_fts MATCH ?
    ORDER BY fts_score
    LIMIT ?
  `;

  const escapedQuery = sanitizeFtsQuery(keywordQuery);
  const result = await db.prepare(sql).bind(...params, escapedQuery, limit).all<{ id: string; fts_score: number }>();

  return result.results.map((r, i) => ({ id: r.id, rank: i + 1 }));
}

/**
 * Enforces hard constraints on semantic search results.
 * Vectorize is great for meaning but bad at hard filters (credits, geneds).
 * This function fetches metadata for semantic candidates and prunes those that violate filters.
 */
export async function postFilterSemanticResults(
  db: D1Database,
  semanticResults: { id: string; score: number }[],
  filters: SearchFilters
): Promise<{ id: string; score: number }[]> {
  if (semanticResults.length === 0) return [];

  // Check if we have any active filters
  const hasActiveFilters = Object.values(filters).some(v => v !== undefined && v !== null && (Array.isArray(v) ? v.length > 0 : true));
  if (!hasActiveFilters) return semanticResults;

  const { joins, where, params, groupBy, having, havingParams } = buildFilterClauses(filters);

  // If no actual SQL constraints generated, return original
  if (where.length === 0 && joins.length === 0 && !having) return semanticResults;

  // Fetch valid course IDs from DB by applying all filters to the candidate set
  const courseIds = semanticResults.map(r => r.id);
  const placeholders = courseIds.map(() => '?').join(',');

  const sql = `
    SELECT c.id
    FROM courses c
    ${joins.join(' ')}
    WHERE c.id IN (${placeholders})
    ${where.length > 0 ? 'AND ' + where.join(' AND ') : ''}
    ${groupBy ? 'GROUP BY ' + groupBy : ''}
    ${having ? 'HAVING ' + having : ''}
  `;

  // Param order: IN clause ids -> WHERE clause params -> HAVING clause params
  const finalParams = [...courseIds, ...params, ...(havingParams || [])];

  const validIdsResult = await db.prepare(sql).bind(...finalParams).all<{ id: string }>();
  const validIdSet = new Set(validIdsResult.results.map(r => r.id));

  return semanticResults.filter(r => validIdSet.has(r.id));
}

export async function hybridSearch(
  db: D1Database,
  vectorize: VectorizeIndex,
  ai: Ai,
  plan: SearchPlan,
  limit: number = 20
): Promise<SearchResult[]> {
  // Pre-processing: Attempt to resolve ambiguous Subject queries (e.g. "Computer Science") to a strict filter
  if (!plan.filters.subject && !plan.filters.number && plan.keywordQuery?.trim()) {
    const cleanQuery = sanitizeFtsQuery(plan.keywordQuery);
    const potentialSubject = await validateSubject(db, cleanQuery);
    if (potentialSubject) {
      plan.filters.subject = potentialSubject;
    }
  }

  const hasSemanticQuery = plan.semanticQuery?.trim().length > 0;
  const hasKeywordQuery = plan.keywordQuery?.trim().length > 0;

  // Detect navigational queries (exact course or CRN)
  const isNavigational = !!((plan.filters.subject && plan.filters.number) || plan.filters.crn);
  const runSemantic = hasSemanticQuery && !isNavigational;

  // Run all searches in parallel, skipping empty queries
  const [rawSemanticResults, courseKeywordResults, sectionKeywordResults] = await Promise.all([
    runSemantic ? semanticSearch(vectorize, ai, plan.semanticQuery, plan.filters, 50) : Promise.resolve([]),
    keywordSearch(db, plan, 50),
    hasKeywordQuery ? sectionKeywordSearch(db, plan.keywordQuery!, plan.filters, 50) : Promise.resolve([])
  ]);

  // Post-filter semantic results for hard constraints
  const semanticResults = runSemantic
    ? await postFilterSemanticResults(db, rawSemanticResults, plan.filters)
    : [];

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

  // Sort by RRF score
  scores.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    const aHasKeyword = a.keywordRank !== undefined;
    const bHasKeyword = b.keywordRank !== undefined;
    if (aHasKeyword !== bHasKeyword) {
      return aHasKeyword ? -1 : 1;
    }
    if (aHasKeyword && bHasKeyword) {
      return (a.keywordRank ?? 0) - (b.keywordRank ?? 0);
    }
    return 0;
  });
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

  // Apply title boost for exact/partial matches
  const resultsWithTitles = topIds.map(s => ({
    ...s,
    title: courseMap.get(s.id)?.title
  }));

  const boostedResults = applyTitleBoost(resultsWithTitles, plan.keywordQuery || '');

  // Return results with scores
  return boostedResults.map(s => ({
    course: courseMap.get(s.id)!,
    score: s.score,
    semanticRank: s.semanticRank,
    keywordRank: s.keywordRank
  })).filter(r => r.course);
}

export async function hybridSearchWithTermRanking(
  db: D1Database,
  vectorize: VectorizeIndex,
  ai: Ai,
  plan: SearchPlan,
  limit: number = 20
): Promise<SearchResult[]> {
  // Get current term states
  const termStates = await db.prepare(`
    SELECT term_id, year, term, status FROM term_state
    WHERE status IN ('active', 'registrable')
    ORDER BY year DESC
  `).all<TermInfo>();

  const activeTerm = termStates.results.find(t => t.status === 'active')?.term_id || null;
  const registrableTerm = termStates.results.find(t => t.status === 'registrable')?.term_id || null;

  // Run standard hybrid search
  const results = await hybridSearch(db, vectorize, ai, plan, limit * 2);

  // Add term info and sort by term priority, then by score
  const enrichedResults = results.map((r) => {
    const termInfo: TermInfo = {
      term_id: `${r.course.year}-${r.course.term}`,
      year: r.course.year,
      term: r.course.term,
      status: 'historical'
    };
    const termPriority = getTermPriority(termInfo, activeTerm, registrableTerm);
    return {
      ...r,
      termPriority,
      historical: termInfo.term_id !== activeTerm && termInfo.term_id !== registrableTerm
    };
  });

  // Sort by term priority first, then by score
  enrichedResults.sort((a, b) => {
    if (a.termPriority !== b.termPriority) {
      return a.termPriority! - b.termPriority!;
    }
    return b.score - a.score;
  });

  return enrichedResults.slice(0, limit);
}
