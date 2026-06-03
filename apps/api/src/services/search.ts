import type { D1Database, VectorizeIndex, Ai } from '@cloudflare/workers-types';
import { searchCourses as semanticSearch } from './embeddings.js';
import { validateSubject } from './query-resolver.js';
import { canonicalGenedCode, canonicalGenedCodes } from './gened-codes.js';
import type { Course } from '../db/index.js';
import type { RetrievalLane, SearchPlan, SearchFilters } from '@uiuc-course-search/query-types';
import { errorFields, logger } from '../observability/logger.js';

export interface SearchResult {
  course: Course;
  score: number;
  semanticRank?: number;
  keywordRank?: number;
  laneMatches?: RetrievalLane[];
  laneRanks?: Partial<Record<RetrievalLane, number>>;
  supportedSubjectiveClaims?: string[];
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
  easy: { max_difficulty: 30 }, // Low workload, independent of composite quality.
  hard: { min_difficulty: 70 }, // High workload, independent of composite quality.
};

const INTRODUCTORY_GATEWAY_NUMBERS: Record<string, string[]> = {
  CS: ['124', '101', '105', '128'],
  ECE: ['110', '120'],
  ECON: ['102', '103'],
  MATH: ['220', '221', '234'],
  PSYC: ['100'],
  SPAN: ['101', '102', '122'],
  STAT: ['100', '107', '200'],
};

const STATUS_VALUES: Record<string, string[]> = {
  'open': ['Open'],
  'available': ['Open', 'Restricted'],
  'closed': ['Closed'],
};

const D1_ID_BATCH_SIZE = 50;

function canonicalAttributeCodeSql(alias: string): string {
  return `CASE WHEN ${alias}.attribute_code LIKE '1%' THEN SUBSTR(${alias}.attribute_code, 2) ELSE ${alias}.attribute_code END`;
}

const DAY_ALIASES: Record<string, string> = {
  monday: 'M',
  mon: 'M',
  m: 'M',
  tuesday: 'T',
  tue: 'T',
  tues: 'T',
  t: 'T',
  wednesday: 'W',
  wed: 'W',
  w: 'W',
  thursday: 'R',
  thu: 'R',
  thur: 'R',
  thurs: 'R',
  r: 'R',
  friday: 'F',
  fri: 'F',
  f: 'F',
};

interface TermInfo {
  term_id: string;
  year: number;
  term: string;
  status: string;
}

function getTermPriority(
  termInfo: TermInfo,
  priorityByTermId: Map<string, number>
): number {
  const knownPriority = priorityByTermId.get(termInfo.term_id);
  if (knownPriority !== undefined) return knownPriority;

  return 10_000 - termChronology(termInfo.year, termInfo.term);
}

function termChronology(year: number, term: string): number {
  const termRank: Record<string, number> = { winter: 1, spring: 2, summer: 3, fall: 4 };
  return year * 4 + (termRank[term.toLowerCase()] ?? 0);
}

function regularTermRank(term: string): number {
  return term === 'fall' || term === 'spring' ? 0 : 1;
}

export function buildTermPriorityMap(termStates: TermInfo[]): Map<string, number> {
  const sorted = [...termStates].sort((left, right) => {
    const statusRank = (status: string): number => status === 'registrable' ? 0 : status === 'active' ? 1 : 2;
    const statusDelta = statusRank(left.status) - statusRank(right.status);
    if (statusDelta !== 0) return statusDelta;
    if (left.year !== right.year) return right.year - left.year;
    const regularTermDelta = regularTermRank(left.term) - regularTermRank(right.term);
    if (regularTermDelta !== 0) return regularTermDelta;
    return termChronology(right.year, right.term) - termChronology(left.year, left.term);
  });

  return new Map(sorted.map((term, index) => [term.term_id, index]));
}

// Reciprocal Rank Fusion constant
const RRF_K = 60;

const LANE_WEIGHTS: Record<RetrievalLane, number> = {
  exact: 9,
  official_text: 1.8,
  requirement: 2.4,
  structured_section: 2,
  student_language_alias: 2.1,
  topic_semantic: 1.4,
  workload_evidence: 2.2,
  help_path: 1,
};

function laneRrfScore(lane: RetrievalLane, rank: number): number {
  return LANE_WEIGHTS[lane] / (RRF_K + rank);
}

export function applyTitleBoost<T extends { id: string; score: number; title?: string }>(
  scores: T[],
  query: string
): T[] {
  const queryLower = query.toLowerCase().trim();
  if (!queryLower) return scores;

  return scores.map(item => {
    if (!item.title) return item;

    const titleLower = item.title.toLowerCase();
    let boost = 0;

    if (titleLower === queryLower) {
      boost = 2.5;  // Exact title queries should beat broad semantic similarity.
    } else if (titleLower.includes(queryLower)) {
      boost = 1.2;  // Query contained in title
    } else if (queryLower.includes(titleLower)) {
      boost = 0.45;  // Title contained in query
    }

    return { ...item, score: item.score + boost };
  }).sort((a, b) => b.score - a.score);
}

function catalogLevel(number: string | null | undefined): number | null {
  const match = /^([1-5])/.exec(number ?? '');
  return match ? Number.parseInt(match[1], 10) * 100 : null;
}

function hasIntroductoryGatewayIntent(plan: SearchPlan): boolean {
  return plan.intents?.includes('introductory_gateway')
    || plan.softPreferences?.introductoryIntent === 'gateway';
}

function normalizedTitle(title: string | null | undefined): string {
  return title?.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() ?? '';
}

function introductoryGatewayTitleAdjustment(title: string | null | undefined): number {
  const titleText = normalizedTitle(title);
  if (!titleText) return 0;

  if (
    titleText.startsWith('introduction to ')
    || titleText.startsWith('intro to ')
    || titleText.startsWith('introductory ')
    || titleText.includes(' introduction to ')
    || titleText.includes(' fundamentals of ')
  ) {
    return 0.75;
  }

  if (
    titleText.includes('undergraduate open seminar')
    || titleText.includes('special topics')
    || titleText.includes('independent study')
  ) {
    return -0.75;
  }

  return 0;
}

function canonicalGatewayNumberAdjustment(course: Course): number {
  const numbers = INTRODUCTORY_GATEWAY_NUMBERS[course.subject.toUpperCase()];
  if (!numbers) return 0;

  const index = numbers.indexOf(course.number);
  return index === -1 ? 0 : 2.0 - (index * 0.1);
}

export function applySearchIntentBoosts(results: SearchResult[], plan: SearchPlan): SearchResult[] {
  if (!hasIntroductoryGatewayIntent(plan)) {
    return results;
  }

  return results.map((result) => {
    const level = catalogLevel(result.course.number);
    let scoreAdjustment = 0;

    if (level === 100) {
      scoreAdjustment += 1.0;
    } else if (level === 200) {
      scoreAdjustment += 0.15;
    } else if (level !== null && level >= 300) {
      scoreAdjustment -= 0.25;
    }

    scoreAdjustment += canonicalGatewayNumberAdjustment(result.course);
    scoreAdjustment += introductoryGatewayTitleAdjustment(result.course.title);

    return {
      ...result,
      score: result.score + scoreAdjustment,
    };
  });
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

  if (filters.year !== undefined) {
    where.push('c.year = ?');
    params.push(filters.year);
  }

  if (filters.term) {
    where.push('c.term = ?');
    params.push(filters.term);
  }

  // Level filter
  if (filters.level !== undefined) {
    const levelExpression = 'CAST(SUBSTR(c.number, 1, 1) AS INTEGER) * 100';
    where.push(
      filters.level >= 500 ? `${levelExpression} >= ?` : `${levelExpression} = ?`
    );
    params.push(filters.level);
  }

  // GenEd filter (single)
  if (filters.gened_code) {
    const genedCode = canonicalGenedCode(filters.gened_code);
    if (genedCode) {
      joinsSet.add('JOIN course_gened cg ON cg.course_id = c.id');
      where.push(`(cg.category_id = ? OR ${canonicalAttributeCodeSql('cg')} = ?)`);
      params.push(genedCode, genedCode);
    }
  }

  // GenEd filter (any)
  if (filters.gened_any?.length) {
    const geneds = canonicalGenedCodes(filters.gened_any);
    if (geneds.length > 0) {
      joinsSet.add('JOIN course_gened cg ON cg.course_id = c.id');
      const placeholders = geneds.map(() => '?').join(',');
      where.push(`(cg.category_id IN (${placeholders}) OR ${canonicalAttributeCodeSql('cg')} IN (${placeholders}))`);
      params.push(...geneds, ...geneds);
    }
  }

  // GenEd filter (all)
  if (filters.gened_all?.length) {
    canonicalGenedCodes(filters.gened_all).forEach((gened, index) => {
      const alias = `cg_all_${index}`;
      where.push(`EXISTS (
        SELECT 1 FROM course_gened ${alias}
        WHERE ${alias}.course_id = c.id
          AND (${alias}.category_id = ? OR ${canonicalAttributeCodeSql(alias)} = ?)
      )`);
      params.push(gened, gened);
    });
  }

  // Part of Term filter
  if (filters.partOfTerm) {
    joinsSet.add('JOIN sections s ON s.course_id = c.id');
    where.push('s.part_of_term = ?');
    params.push(filters.partOfTerm);
  }

  // Instructor filter
  if (filters.instructor_ids?.length) {
    joinsSet.add('JOIN sections s ON s.course_id = c.id');
    joinsSet.add('JOIN meetings m ON m.section_id = s.id');
    joinsSet.add('JOIN meeting_instructors mi ON mi.meeting_id = m.id');
    const placeholders = filters.instructor_ids.map(() => '?').join(',');
    where.push(`mi.instructor_id IN (${placeholders})`);
    params.push(...filters.instructor_ids);
  }

  // Days filter
  if (filters.days) {
    joinsSet.add('JOIN sections s ON s.course_id = c.id');
    joinsSet.add('JOIN meetings m ON m.section_id = s.id');
    where.push('m.days = ?');
    params.push(filters.days);
  }

  // Time filter
  if (filters.time) {
    const range = TIME_RANGES[filters.time];
    if (range) {
      joinsSet.add('JOIN sections s ON s.course_id = c.id');
      joinsSet.add('JOIN meetings m ON m.section_id = s.id');
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
    joinsSet.add('JOIN meetings m ON m.section_id = s.id');
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

    if ('min_difficulty' in thresholds) {
      // (Difficulty Score >= X) OR (Difficulty Score IS NULL AND Legacy GPA <= 3.0)
      // Note: Low GPA = High Difficulty
      where.push('(c.difficulty_score >= ? OR (c.difficulty_score IS NULL AND c.avg_gpa <= 3.0))');
      params.push(thresholds.min_difficulty);
    }
    if ('max_difficulty' in thresholds) {
      // (Difficulty Score <= X) OR (Difficulty Score IS NULL AND Legacy GPA >= 3.5)
      // Note: High GPA = Low Difficulty
      where.push('(c.difficulty_score <= ? OR (c.difficulty_score IS NULL AND c.avg_gpa >= 3.5))');
      params.push(thresholds.max_difficulty);
    }
  }

  // Negation filters
  if (filters.not) {
    // Negated time ranges
    if (filters.not.time?.length) {
      for (const timeNeg of filters.not.time) {
        const range = TIME_RANGES[timeNeg];
        if (range) {
          if (range.start && range.end) {
            where.push(`NOT EXISTS (
              SELECT 1 FROM sections s2
              JOIN meetings m2 ON m2.section_id = s2.id
              WHERE s2.course_id = c.id
                AND m2.start_time >= ?
                AND m2.start_time < ?
            )`);
            params.push(range.start, range.end);
          } else if (range.end) {
            where.push(`NOT EXISTS (
              SELECT 1 FROM sections s2
              JOIN meetings m2 ON m2.section_id = s2.id
              WHERE s2.course_id = c.id
                AND m2.start_time < ?
            )`);
            params.push(range.end);
          } else if (range.start) {
            where.push(`NOT EXISTS (
              SELECT 1 FROM sections s2
              JOIN meetings m2 ON m2.section_id = s2.id
              WHERE s2.course_id = c.id
                AND m2.start_time >= ?
            )`);
            params.push(range.start);
          }
        }
      }
    }

    // Negated days
    if (filters.not.days?.length) {
      for (const daysNeg of filters.not.days) {
        const dayCode = normalizeDayToken(daysNeg);
        if (dayCode.length === 1) {
          where.push(`NOT EXISTS (
            SELECT 1 FROM sections s2
            JOIN meetings m2 ON m2.section_id = s2.id
            WHERE s2.course_id = c.id
              AND m2.days LIKE ?
          )`);
          params.push(`%${dayCode}%`);
        } else {
          where.push(`NOT EXISTS (
            SELECT 1 FROM sections s2
            JOIN meetings m2 ON m2.section_id = s2.id
            WHERE s2.course_id = c.id
              AND m2.days = ?
          )`);
          params.push(dayCode);
        }
      }
    }

    // Negated instructors
    if (filters.not.instructor_ids?.length) {
      const placeholders = filters.not.instructor_ids.map(() => '?').join(',');
      where.push(`NOT EXISTS (
        SELECT 1 FROM sections s2
        JOIN meetings m2 ON m2.section_id = s2.id
        JOIN meeting_instructors mi2 ON mi2.meeting_id = m2.id
        WHERE s2.course_id = c.id
          AND mi2.instructor_id IN (${placeholders})
      )`);
      params.push(...filters.not.instructor_ids);
    }

    if (filters.not.subjects?.length) {
      const subjects = [...new Set(filters.not.subjects.map(subject => subject.toUpperCase()))];
      const placeholders = subjects.map(() => '?').join(',');
      where.push(`c.subject NOT IN (${placeholders})`);
      params.push(...subjects);
    }

    if (filters.not.geneds?.length) {
      const geneds = canonicalGenedCodes(filters.not.geneds);
      if (geneds.length > 0) {
        const placeholders = geneds.map(() => '?').join(',');
        where.push(`NOT EXISTS (
          SELECT 1 FROM course_gened cg_neg
          WHERE cg_neg.course_id = c.id
            AND (cg_neg.category_id IN (${placeholders}) OR ${canonicalAttributeCodeSql('cg_neg')} IN (${placeholders}))
        )`);
        params.push(...geneds, ...geneds);
      }
    }

    if (filters.not.keywords?.length) {
      for (const keyword of filters.not.keywords) {
        const normalized = keyword.toLowerCase().trim();
        if (!normalized) continue;
        const likeValue = `%${normalized}%`;
        where.push(`LOWER(
          COALESCE(c.subject, '') || ' ' ||
          COALESCE(c.title, '') || ' ' ||
          COALESCE(c.description, '') || ' ' ||
          COALESCE(c.course_info, '') || ' ' ||
          COALESCE(c.degree_attributes, '')
        ) NOT LIKE ?`);
        params.push(likeValue);
      }
    }
  }

  return {
    joins: Array.from(joinsSet),
    where,
    params,
    havingParams,
  };
}

function normalizeDayToken(day: string): string {
  const normalized = day.trim().toLowerCase();
  return DAY_ALIASES[normalized] ?? day.trim().toUpperCase();
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

  // Replace punctuation that might break FTS5. Apostrophes are not worth keeping:
  // contractions like "what's" should never be able to produce a MATCH syntax error.
  sanitized = sanitized.replace(/['’]/g, ' ');
  sanitized = sanitized.replace(/[^\w\s"]/g, ' ');

  // Collapse whitespace
  return sanitized.replace(/\s+/g, ' ').trim();
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, match => `\\${match}`);
}

const TITLE_LANE_BLOCK_WORDS = new Set([
  'after',
  'avoid',
  'before',
  'booster',
  'campus',
  'chill',
  'class',
  'classes',
  'count',
  'counts',
  'course',
  'courses',
  'does',
  'easy',
  'easiest',
  'evening',
  'friday',
  'gen',
  'gened',
  'gpa',
  'hard',
  'hardest',
  'how',
  'is',
  'less',
  'monday',
  'morning',
  'no',
  'not',
  'online',
  'prof',
  'professor',
  'requirement',
  'should',
  'tuesday',
  'urbana',
  'wednesday',
  'what',
  'whats',
  'with',
  'without',
]);

function titleLaneQuery(plan: SearchPlan, cleanKeywordQuery: string): string {
  const rawCandidate = sanitizeFtsQuery(plan.rawQuery ?? '').replace(/"/g, '').toLowerCase().trim();
  const candidate = rawCandidate || cleanKeywordQuery.replace(/"/g, '').toLowerCase().trim();
  if (!candidate || candidate.length > 80) return '';

  const tokens = candidate.split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 5) return '';
  if (tokens.some(token => TITLE_LANE_BLOCK_WORDS.has(token))) return '';

  return candidate;
}

export async function titleKeywordSearch(
  db: D1Database,
  keywordQuery: string,
  filters: SearchFilters,
  limit: number = 20,
): Promise<{ id: string; rank: number }[]> {
  const titleNeedle = keywordQuery.replace(/"/g, '').toLowerCase().trim();
  if (!titleNeedle) return [];

  const filterResults = buildFilterClauses(filters);
  const { joins, where, params, having, havingParams } = filterResults;
  const titlePrefix = `${escapeLike(titleNeedle)}%`;
  const titleContains = `%${escapeLike(titleNeedle)}%`;
  const titleWhere = "LOWER(c.title) LIKE ? ESCAPE '\\'";
  const whereClause = where.length > 0
    ? `WHERE ${where.join(' AND ')} AND ${titleWhere}`
    : `WHERE ${titleWhere}`;

  const sql = `
    SELECT c.id,
      MIN(CASE
        WHEN LOWER(c.title) = ? THEN 1
        WHEN LOWER(c.title) LIKE ? ESCAPE '\\' THEN 2
        ELSE 3
      END) as title_rank
    FROM courses c
    ${joins.join(' ')}
    ${whereClause}
    GROUP BY c.id
    ${having ? 'HAVING ' + having : ''}
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

  return result.results.map((row, index) => ({ id: row.id, rank: index + 1 }));
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
  const titleQuery = hasKeyword ? titleLaneQuery(plan, cleanQuery) : '';
  const titleResults = hasKeyword
    ? await titleKeywordSearch(db, titleQuery, filters, limit)
    : [];
  let searchParam = cleanQuery;

  // Query Expansion: "Computer Science" -> ("Computer Science") OR CS
  if (hasKeyword && !filters.subject && !filters.number) {
    const subjectId = await validateSubject(db, cleanQuery);
    if (subjectId) {
      const escaped = cleanQuery.replace(/"/g, '""');
      searchParam = `"${escaped}" OR ${subjectId}`;
    }
  }
  const finalParams = hasKeyword ? [...params, searchParam, limit] : [...params, limit];


  const sql = hasKeyword ? `
    SELECT DISTINCT c.id, bm25(courses_fts, 10.0, 10.0, 2.0, 0.5, 1.0, 1.0) as fts_score
    FROM courses_fts fts
    JOIN courses c ON c.rowid = fts.rowid
    ${joinClause}
    ${whereClause}
    ${whereClause ? 'AND' : 'WHERE'} courses_fts MATCH ?
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

  const result = await db.prepare(sql).bind(...finalParams).all<{ id: string; fts_score: number }>();

  const ftsResults = result.results.map((r, i) => ({ id: r.id, rank: i + 1 }));
  if (titleResults.length === 0) {
    return ftsResults;
  }

  const seen = new Set<string>();
  const combined: { id: string; rank: number }[] = [];
  for (const row of [...titleResults, ...ftsResults]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    combined.push({ id: row.id, rank: combined.length + 1 });
    if (combined.length >= limit) break;
  }

  return combined;
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

  // Filter out duplicate 'JOIN sections s' since we already join it manually below
  const uniqueJoins = joins.filter(j => !j.includes('JOIN sections s '));
  const joinClause = uniqueJoins.join(' ');

  const sql = `
    SELECT DISTINCT c.id, bm25(sections_fts) as fts_score
    FROM sections_fts fts
    JOIN sections s ON s.rowid = fts.rowid
    JOIN courses c ON s.course_id = c.id
    ${joinClause}
    ${whereClause}
    ${whereClause ? 'AND' : 'WHERE'} sections_fts MATCH ?
    ORDER BY fts_score ASC
    LIMIT ?
  `;

  const escapedQuery = sanitizeFtsQuery(keywordQuery);
  const result = await db.prepare(sql).bind(...params, escapedQuery, limit).all<{ id: string; fts_score: number }>();

  return result.results.map((r, i) => ({ id: r.id, rank: i + 1 }));
}

export async function requirementLaneSearch(
  db: D1Database,
  plan: SearchPlan,
  limit: number = 50
): Promise<{ id: string; rank: number }[]> {
  const hasRequirementFilter = Boolean(
    plan.filters.gened_code
    || plan.filters.gened_any?.length
    || plan.filters.gened_all?.length
  );
  const hasRequirementIntent = plan.rescue?.queryTypes.includes('requirement')
    || plan.rescue?.queryTypes.includes('degree_progress');

  if (!hasRequirementFilter && !hasRequirementIntent) {
    return [];
  }

  const filterResults = buildFilterClauses(plan.filters);
  const { joins, where, params, groupBy, having, havingParams } = filterResults;
  const effectiveJoins = [...joins];

  if (!hasRequirementFilter && hasRequirementIntent) {
    effectiveJoins.push('JOIN course_gened cg_requirement ON cg_requirement.course_id = c.id');
  }

  if (where.length === 0 && effectiveJoins.length === 0) {
    return [];
  }

  const sql = `
    SELECT DISTINCT c.id
    FROM courses c
    ${effectiveJoins.join(' ')}
    ${where.length > 0 ? 'WHERE ' + where.join(' AND ') : ''}
    ${groupBy ? 'GROUP BY ' + groupBy : ''}
    ${having ? 'HAVING ' + having : ''}
    ORDER BY c.year DESC, c.subject, c.number
    LIMIT ?
  `;

  const result = await db.prepare(sql)
    .bind(...params, ...(havingParams ?? []), limit)
    .all<{ id: string }>();

  return result.results.map((r, i) => ({ id: r.id, rank: i + 1 }));
}

export async function structuredSectionLaneSearch(
  db: D1Database,
  plan: SearchPlan,
  limit: number = 50
): Promise<{ id: string; rank: number }[]> {
  const hasSectionFilter = Boolean(
    plan.filters.online !== undefined
    || plan.filters.days
    || plan.filters.time
    || plan.filters.status
    || plan.filters.partOfTerm
  );
  const hasSectionPreference = Boolean(
    plan.softPreferences?.startAfterMinutes
    || plan.softPreferences?.startBeforeMinutes
    || plan.softPreferences?.compressedTerm
    || plan.softPreferences?.asyncFriendly
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
    ${joins.join(' ')}
    ${where.length > 0 ? 'WHERE ' + where.join(' AND ') : ''}
    ${groupBy ? 'GROUP BY ' + groupBy : ''}
    ${having ? 'HAVING ' + having : ''}
    ORDER BY c.year DESC, c.subject, c.number
    LIMIT ?
  `;

  const result = await db.prepare(sql)
    .bind(...params, ...(havingParams ?? []), limit)
    .all<{ id: string }>();

  return result.results.map((r, i) => ({ id: r.id, rank: i + 1 }));
}

export async function studentAliasLaneSearch(
  db: D1Database,
  plan: SearchPlan,
  limit: number = 50
): Promise<{ id: string; rank: number }[]> {
  const aliasQuery = buildAliasLaneQuery(plan);
  if (!aliasQuery) {
    return [];
  }

  const filterResults = buildFilterClauses(plan.filters);
  const { joins, where, params, groupBy, having, havingParams } = filterResults;
  const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
  const joinClause = joins.join(' ');

  const sql = `
    SELECT DISTINCT c.id, bm25(course_aliases_fts) as fts_score
    FROM course_aliases_fts fts
    JOIN course_aliases ca ON ca.rowid = fts.rowid
    JOIN courses c ON c.id = ca.course_id
    ${joinClause}
    ${whereClause}
    ${whereClause ? 'AND' : 'WHERE'} course_aliases_fts MATCH ?
    ${groupBy ? 'GROUP BY ' + groupBy : ''}
    ${having ? 'HAVING ' + having : ''}
    ORDER BY fts_score ASC
    LIMIT ?
  `;

  const result = await db.prepare(sql)
    .bind(...params, aliasQuery, ...(havingParams ?? []), limit)
    .all<{ id: string; fts_score: number }>();

  return result.results.map((r, i) => ({ id: r.id, rank: i + 1 }));
}

export async function workloadEvidenceLaneSearch(
  db: D1Database,
  plan: SearchPlan,
  limit: number = 50
): Promise<{ id: string; rank: number; claims: string[] }[]> {
  const signalTypes = workloadSignalTypes(plan);
  if (signalTypes.length === 0) {
    return [];
  }

  const filterResults = buildFilterClauses(plan.filters);
  const { joins, where, params, groupBy, having, havingParams } = filterResults;
  const signalPlaceholders = signalTypes.map(() => '?').join(',');
  const whereParts = [`cs.signal_type IN (${signalPlaceholders})`, ...where];

  const sql = `
    SELECT c.id,
      GROUP_CONCAT(DISTINCT cs.signal_type) as claims,
      MAX(COALESCE(cs.confidence, 0) * COALESCE(cs.value, 0)) as evidence_score
    FROM course_signals cs
    JOIN courses c ON c.id = cs.course_id
    ${joins.join(' ')}
    WHERE ${whereParts.join(' AND ')}
    ${groupBy ? 'GROUP BY ' + groupBy + ', c.id' : 'GROUP BY c.id'}
    ${having ? 'HAVING ' + having : ''}
    ORDER BY evidence_score DESC, c.year DESC, c.subject, c.number
    LIMIT ?
  `;

  const result = await db.prepare(sql)
    .bind(...signalTypes, ...params, ...(havingParams ?? []), limit)
    .all<{ id: string; claims: string | null; evidence_score: number | null }>();

  return result.results.map((r, i) => ({
    id: r.id,
    rank: i + 1,
    claims: r.claims?.split(',').filter(Boolean) ?? [],
  }));
}

function buildAliasLaneQuery(plan: SearchPlan): string {
  const terms = new Set<string>();
  for (const value of [plan.keywordQuery, plan.semanticQuery]) {
    if (value?.trim()) terms.add(value.trim());
  }
  for (const value of plan.rescue?.topicTerms ?? []) terms.add(value);
  for (const value of plan.rescue?.expandedTerms ?? []) terms.add(value);
  for (const value of plan.rescue?.negativeTerms ?? []) terms.add(value.replace(/_/g, ' '));
  for (const assumption of plan.rescue?.assumptions ?? []) {
    terms.add(assumption.kind.replace(/_/g, ' '));
    terms.add(assumption.label);
  }

  const sanitizedTerms = Array.from(terms)
    .map(term => sanitizeFtsQuery(term))
    .filter(Boolean)
    .slice(0, 12);

  return sanitizedTerms.length > 0 ? sanitizedTerms.join(' OR ') : '';
}

function workloadSignalTypes(plan: SearchPlan): string[] {
  const types = new Set<string>();
  const soft = plan.softPreferences ?? {};

  if (soft.lowWorkload || plan.filters.difficulty === 'easy') {
    ['low_workload', 'high_avg_gpa', 'non_major_friendly'].forEach(type => types.add(type));
  }
  if (soft.lowWriting) {
    ['low_writing', 'writing_light', 'few_papers'].forEach(type => types.add(type));
  }
  if (soft.lowReading) {
    ['low_reading', 'reading_light'].forEach(type => types.add(type));
  }
  if (soft.lowExams) {
    ['low_exams', 'low_exam', 'quiz_based'].forEach(type => types.add(type));
  }
  if (soft.lowMath) {
    ['low_math', 'non_quantitative', 'non_major_friendly'].forEach(type => types.add(type));
  }
  if (soft.noListedPrereq) {
    ['no_listed_prereq', 'non_major_friendly'].forEach(type => types.add(type));
  }
  if (soft.fun) {
    types.add('interesting_topic');
  }

  return Array.from(types);
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
  const validIdSet = new Set<string>();

  for (const batch of chunkValues(courseIds, D1_ID_BATCH_SIZE)) {
    const placeholders = batch.map(() => '?').join(',');

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
    const finalParams = [...batch, ...params, ...(havingParams || [])];
    const validIdsResult = await db.prepare(sql).bind(...finalParams).all<{ id: string }>();
    for (const row of validIdsResult.results) {
      validIdSet.add(row.id);
    }
  }

  return semanticResults.filter(r => validIdSet.has(r.id));
}

export async function hybridSearch(
  db: D1Database,
  vectorize: VectorizeIndex,
  ai: Ai,
  plan: SearchPlan,
  limit: number = 20
): Promise<SearchResult[]> {
  const candidateLimit = Math.max(50, limit);

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
  const [
    rawSemanticResults,
    courseKeywordResults,
    sectionKeywordResults,
    requirementResults,
    structuredSectionResults,
    aliasResults,
    workloadResults,
  ] = await Promise.all([
    runSemantic
      ? semanticSearch(vectorize, ai, plan.semanticQuery, plan.filters, candidateLimit).catch(err => {
          logger.warn('search.semantic.failed', { ...errorFields(err) });
          return [];
        })
      : Promise.resolve([]),
    keywordSearch(db, plan, candidateLimit),
    hasKeywordQuery ? sectionKeywordSearch(db, plan.keywordQuery!, plan.filters, candidateLimit) : Promise.resolve([]),
    requirementLaneSearch(db, plan, candidateLimit).catch(err => {
      logger.warn('search.requirement_lane.failed', { ...errorFields(err) });
      return [];
    }),
    structuredSectionLaneSearch(db, plan, candidateLimit).catch(err => {
      logger.warn('search.section_lane.failed', { ...errorFields(err) });
      return [];
    }),
    studentAliasLaneSearch(db, plan, candidateLimit).catch(err => {
      logger.warn('search.alias_lane.failed', { ...errorFields(err) });
      return [];
    }),
    workloadEvidenceLaneSearch(db, plan, candidateLimit).catch(err => {
      logger.warn('search.workload_lane.failed', { ...errorFields(err) });
      return [];
    }),
  ]);

  // Post-filter semantic results for hard constraints
  const semanticResults = runSemantic
    ? await postFilterSemanticResults(db, rawSemanticResults, plan.filters)
    : [];

  const laneRanks = new Map<string, Partial<Record<RetrievalLane, number>>>();
  const supportedClaims = new Map<string, Set<string>>();
  const addLaneRanks = (lane: RetrievalLane, rows: { id: string; rank: number }[]): void => {
    rows.forEach((row, index) => {
      const rank = row.rank ?? index + 1;
      const ranks = laneRanks.get(row.id) ?? {};
      const existing = ranks[lane];
      if (!existing || rank < existing) {
        ranks[lane] = rank;
      }
      laneRanks.set(row.id, ranks);
    });
  };

  addLaneRanks(isNavigational ? 'exact' : 'official_text', courseKeywordResults);
  addLaneRanks('structured_section', sectionKeywordResults);
  addLaneRanks('requirement', requirementResults);
  addLaneRanks('structured_section', structuredSectionResults);
  addLaneRanks('student_language_alias', aliasResults);
  addLaneRanks('topic_semantic', semanticResults.map((row, index) => ({ id: row.id, rank: index + 1 })));
  addLaneRanks('workload_evidence', workloadResults);
  for (const row of workloadResults) {
    supportedClaims.set(row.id, new Set(row.claims));
  }

  const allIds = new Set(laneRanks.keys());

  const allIdList = Array.from(allIds);
  const qualityScores = await fetchQualityScores(db, allIdList);

  const scores: {
    id: string;
    score: number;
    semanticRank?: number;
    keywordRank?: number;
    laneMatches: RetrievalLane[];
    laneRanks: Partial<Record<RetrievalLane, number>>;
    supportedSubjectiveClaims: string[];
  }[] = [];

  for (const id of allIdList) {
    let score = 0;
    const ranks = laneRanks.get(id) ?? {};
    const semanticRank = ranks.topic_semantic;
    const keywordRank = bestKeywordLikeRank(ranks);
    const qualityScore = qualityScores.get(id);

    for (const [lane, rank] of Object.entries(ranks) as [RetrievalLane, number][]) {
      score += laneRrfScore(lane, rank);
      if (lane === 'exact') score += 3.5;
    }
    if (qualityScore) score += qualityScore / 250;

    scores.push({
      id,
      score,
      semanticRank,
      keywordRank,
      laneMatches: Object.keys(ranks) as RetrievalLane[],
      laneRanks: ranks,
      supportedSubjectiveClaims: Array.from(supportedClaims.get(id) ?? []),
    });
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

  if (scores.length === 0) {
    return [];
  }

  const courseMap = await fetchCoursesById(db, scores.map(s => s.id));

  // Apply title boost before trimming candidates so exact title matches are not
  // discarded by weaker pre-boost semantic scores.
  const resultsWithTitles = scores.map(s => ({
    ...s,
    title: courseMap.get(s.id)?.title
  }));

  const boostedResults = applyTitleBoost(resultsWithTitles, plan.keywordQuery || '')
    .slice(0, limit);

  // Return results with scores
  const rankedResults = boostedResults.map(s => ({
    course: courseMap.get(s.id)!,
    score: s.score,
    semanticRank: s.semanticRank,
    keywordRank: s.keywordRank,
    laneMatches: s.laneMatches,
    laneRanks: s.laneRanks,
    supportedSubjectiveClaims: s.supportedSubjectiveClaims,
  })).filter(r => r.course);

  return applyUsefulnessRerank(rankedResults, plan);
}

function bestKeywordLikeRank(ranks: Partial<Record<RetrievalLane, number>>): number | undefined {
  const keywordRanks = [
    ranks.exact,
    ranks.official_text,
    ranks.requirement,
    ranks.structured_section,
    ranks.student_language_alias,
    ranks.workload_evidence,
  ].filter((rank): rank is number => typeof rank === 'number');

  return keywordRanks.length > 0 ? Math.min(...keywordRanks) : undefined;
}

export function applyUsefulnessRerank(results: SearchResult[], plan: SearchPlan): SearchResult[] {
  const reranked = results.map(result => {
    let score = result.score;
    const course = result.course;

    if (result.laneMatches?.includes('exact')) {
      score += 2.5;
    }

    if (matchesRequestedRequirement(course, plan.filters)) {
      score += 0.9;
    } else if (hasRequirementIntent(plan) && course.gened) {
      score += 0.25;
    } else if (hasRequirementIntent(plan) && !course.gened) {
      score -= 0.25;
    }

    if (result.laneMatches?.includes('structured_section')) {
      score += 0.35;
    }

    if (result.laneMatches?.includes('student_language_alias')) {
      score += 0.25;
    }

    if (result.laneMatches?.includes('workload_evidence')) {
      score += 0.45;
    }

    score += workloadUsefulnessAdjustment(result, plan);
    score += eligibilityAdjustment(course, plan);
    score += negativePreferencePenalty(course, plan);
    score += unsupportedSubjectivePenalty(result, plan);

    return {
      ...result,
      score,
    };
  });

  return reranked.sort((a, b) => b.score - a.score);
}

function hasRequirementIntent(plan: SearchPlan): boolean {
  return Boolean(
    plan.filters.gened_code
    || plan.filters.gened_any?.length
    || plan.filters.gened_all?.length
    || plan.rescue?.queryTypes.includes('requirement')
    || plan.rescue?.queryTypes.includes('degree_progress')
  );
}

function matchesRequestedRequirement(course: Course, filters: SearchFilters): boolean {
  const requested = [
    filters.gened_code,
    ...(filters.gened_any ?? []),
    ...(filters.gened_all ?? []),
  ].filter((value): value is string => Boolean(value));

  if (requested.length === 0) {
    return false;
  }

  const courseGened = (course.gened ?? '').toUpperCase();
  return requested.some(value => courseGened.includes(value.toUpperCase()));
}

function workloadUsefulnessAdjustment(result: SearchResult, plan: SearchPlan): number {
  const soft = plan.softPreferences ?? {};
  const hasEasyIntent = Boolean(
    soft.lowWorkload
    || soft.lowWriting
    || soft.lowReading
    || soft.lowExams
    || soft.nonMajorFriendly
    || plan.filters.difficulty === 'easy'
  );

  if (!hasEasyIntent) {
    return 0;
  }

  let adjustment = 0;
  const { course } = result;
  const level = catalogLevel(course.number);
  if (typeof course.quality_score === 'number' && course.quality_score >= 70) adjustment += 0.25;
  if (typeof course.difficulty_score === 'number' && course.difficulty_score <= 35) adjustment += 0.3;
  if (typeof course.avg_gpa === 'number' && course.avg_gpa >= 3.5) adjustment += 0.2;
  if (level === 100) adjustment += 0.55;
  if (level === 200) adjustment += 0.35;
  if (level === 300) adjustment += 0.05;
  if (level === 400) adjustment -= 0.35;
  if (level !== null && level >= 500) adjustment -= 1.25;
  if (result.laneMatches?.includes('workload_evidence')) adjustment += 0.3;

  return adjustment;
}

function eligibilityAdjustment(course: Course, plan: SearchPlan): number {
  if (!plan.softPreferences?.noListedPrereq) {
    return 0;
  }

  const text = `${course.title ?? ''} ${course.description ?? ''}`.toLowerCase();
  if (!/\b(prereq|prerequisite|consent|restricted|permission|credit or concurrent)\b/.test(text)) {
    return 0.35;
  }
  return -0.35;
}

function negativePreferencePenalty(course: Course, plan: SearchPlan): number {
  const negativeTerms = new Set([
    ...(plan.rescue?.negativeTerms ?? []),
    ...(plan.filters.not?.keywords ?? []),
  ]);
  const excludedSubjects = new Set((plan.filters.not?.subjects ?? []).map(subject => subject.toUpperCase()));
  let penalty = 0;

  if (negativeTerms.has('math_heavy') || plan.softPreferences?.lowMath || excludedSubjects.has('MATH') || excludedSubjects.has('STAT')) {
    const text = `${course.subject} ${course.title ?? ''} ${course.description ?? ''} ${course.gened ?? ''}`.toLowerCase();
    if (/\b(qr|quantitative|calculus|statistics|statistical|programming|formal logic)\b/.test(text)) {
      penalty -= 0.7;
    }
    if (['MATH', 'STAT'].includes(course.subject.toUpperCase())) {
      penalty -= 0.4;
    }
  }

  if (negativeTerms.has('writing_heavy') || negativeTerms.has('writing') || negativeTerms.has('essay') || negativeTerms.has('essays') || plan.softPreferences?.lowWriting) {
    const text = `${course.title ?? ''} ${course.description ?? ''} ${course.gened ?? ''}`.toLowerCase();
    if (/\b(advanced composition|writing intensive|essay|papers?)\b/.test(text)) {
      penalty -= 0.55;
    }
  }

  if (negativeTerms.has('biology_heavy') || excludedSubjects.has('MCB') || excludedSubjects.has('IB')) {
    const text = `${course.subject} ${course.title ?? ''} ${course.description ?? ''}`.toLowerCase();
    if (/\b(bio|biology|biological|molecular|cellular|anatomy|physiology)\b/.test(text)) {
      penalty -= 0.45;
    }
    if (['IB', 'MCB'].includes(course.subject.toUpperCase())) {
      penalty -= 0.35;
    }
  }

  if (negativeTerms.has('lab') || negativeTerms.has('labs')) {
    const text = `${course.title ?? ''} ${course.description ?? ''} ${course.course_info ?? ''}`.toLowerCase();
    if (/\b(lab|laboratory)\b/.test(text)) {
      penalty -= 0.45;
    }
  }

  if (negativeTerms.has('coding') || negativeTerms.has('programming')) {
    const text = `${course.subject} ${course.title ?? ''} ${course.description ?? ''}`.toLowerCase();
    if (/\b(coding|programming|programs?|software|computer science)\b/.test(text) || course.subject === 'CS') {
      penalty -= 0.55;
    }
  }

  return penalty;
}

function unsupportedSubjectivePenalty(result: SearchResult, plan: SearchPlan): number {
  const needsEvidence = Boolean(
    plan.rescue?.queryTypes.includes('subjective_vibe')
    || plan.rescue?.queryTypes.includes('avoidance')
  );
  if (!needsEvidence) return 0;

  const hasStructuredSupport = result.laneMatches?.includes('workload_evidence')
    || Boolean(result.supportedSubjectiveClaims?.length)
    || typeof result.course.quality_score === 'number'
    || typeof result.course.difficulty_score === 'number'
    || typeof result.course.avg_gpa === 'number';

  return hasStructuredSupport ? 0 : -0.35;
}

async function fetchQualityScores(db: D1Database, courseIds: string[]): Promise<Map<string, number>> {
  const qualityScores = new Map<string, number>();
  if (courseIds.length === 0) {
    return qualityScores;
  }

  for (const batch of chunkValues(courseIds, D1_ID_BATCH_SIZE)) {
    const placeholders = batch.map(() => '?').join(',');
    const result = await db.prepare(`
      SELECT id, quality_score FROM courses WHERE id IN (${placeholders})
    `).bind(...batch).all<{ id: string; quality_score: number | null }>();

    for (const row of result.results) {
      if (row.quality_score !== null && row.quality_score !== undefined) {
        qualityScores.set(row.id, row.quality_score);
      }
    }
  }

  return qualityScores;
}

async function fetchCoursesById(db: D1Database, courseIds: string[]): Promise<Map<string, Course>> {
  const courseMap = new Map<string, Course>();
  if (courseIds.length === 0) {
    return courseMap;
  }

  for (const batch of chunkValues(courseIds, D1_ID_BATCH_SIZE)) {
    const placeholders = batch.map(() => '?').join(',');
    const result = await db.prepare(`
      SELECT
        c.*,
        g.median_gpa as median_gpa
      FROM courses c
      LEFT JOIN gpa_stats g
        ON g.subject = c.subject
        AND g.number = c.number
        AND g.instructor IS NULL
      WHERE c.id IN (${placeholders})
    `).bind(...batch).all<Course>();

    for (const course of result.results) {
      courseMap.set(course.id, course);
    }
  }

  return courseMap;
}

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
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
  `).all<TermInfo>();

  const priorityByTermId = buildTermPriorityMap(termStates.results);
  const currentTermIds = new Set(termStates.results.map(term => term.term_id));

  // Run standard hybrid search
  const results = await hybridSearch(db, vectorize, ai, plan, limit * 2);

  // Add term info and sort by term priority, then by score
  const enrichedResults = applySearchIntentBoosts(results.map((r) => {
    const termInfo: TermInfo = {
      term_id: `${r.course.year}-${r.course.term}`,
      year: r.course.year,
      term: r.course.term,
      status: 'historical'
    };
    const termPriority = getTermPriority(termInfo, priorityByTermId);
    return {
      ...r,
      termPriority,
      historical: !currentTermIds.has(termInfo.term_id)
    };
  }), plan);

  // Sort by term priority first, then by score
  enrichedResults.sort((a, b) => {
    if (a.termPriority !== b.termPriority) {
      return a.termPriority! - b.termPriority!;
    }
    return b.score - a.score;
  });

  return enrichedResults.slice(0, limit);
}
