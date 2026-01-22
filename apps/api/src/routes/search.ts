import { Hono } from 'hono';
import type { D1Database, VectorizeIndex, Ai } from '@cloudflare/workers-types';
import { searchCourses } from '../services/embeddings.js';
import { hybridSearchWithTermRanking, keywordSearch } from '../services/search.js';
import { resolveQuery } from '../services/query-resolver.js';
import { parseQuery } from '../services/query-parser.js';
import { extract } from '../services/extractor.js';
import type { ExtractedQuery, SearchPlan, QueryHint, QueryHintType } from '@uiuc-course-search/query-types';

type Bindings = {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
};

function mapHintType(type: string): QueryHintType {
  const mapping: Record<string, QueryHintType> = {
    'courseCode': 'course_code',
    'crn': 'crn',
    'subject': 'subject',
    'instructor': 'instructor',
    'days': 'days',
    'time': 'time',
    'level': 'level',
    'credits': 'credits',
    'online': 'online',
    'status': 'status',
    'difficulty': 'difficulty',
    'gened': 'gened',
  };
  return (mapping[type] || type) as QueryHintType;
}

export const searchRoutes = new Hono<{ Bindings: Bindings }>();

// Semantic search endpoint
searchRoutes.get('/search/semantic', async (c) => {
  const query = c.req.query('q');
  if (!query) {
    return c.json({ error: 'Missing query parameter q' }, 400);
  }

  try {
    const results = await searchCourses(c.env.VECTORIZE, c.env.AI, query, undefined, 20);
    return c.json({ results });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// Hybrid search endpoint (combines semantic + keyword with RRF)
searchRoutes.get('/api/search', async (c) => {
  const query = c.req.query('q');
  if (!query) {
    return c.json({ error: 'Missing query parameter q' }, 400);
  }

  const startTime = performance.now();

  // 1. Parse power-user syntax (field:value, gened:any/all, negations, phrases)
  const parsed = parseQuery(query);
  const parseEndTime = performance.now();

  // 2. Extract hints from residual using three-phase extraction
  const extraction = extract(parsed.clauses[0].residual);
  const extractionEndTime = performance.now();

  // 3. Bridge to old ExtractedQuery format for resolver
  const extractedQuery: ExtractedQuery = {
    rawQuery: query,
    hints: extraction.hints.map(hint => {
      const queryHint: QueryHint = {
        type: mapHintType(hint.type),
        value: typeof hint.value === 'object' && 'subject' in hint.value
          ? `${hint.value.subject} ${hint.value.number}`
          : String(hint.value),
        confidence: hint.metadata.confidence,
        isExplicit: hint.metadata.source === 'regex',
        metadata: hint.type === 'courseCode' && typeof hint.value === 'object' && 'subject' in hint.value
          ? { subject: hint.value.subject, number: hint.value.number }
          : undefined,
      };
      return queryHint;
    }),
    residual: extraction.residual,
  };

  // 4. Resolve hints against database
  const plan = await resolveQuery(c.env.DB, extractedQuery);
  const resolveEndTime = performance.now();

  // 5. Apply parsed filters from power-user syntax
  const clause = parsed.clauses[0];
  for (const filter of clause.filters) {
    if (filter.field === 'subject') plan.filters.subject = filter.value.toUpperCase();
    if (filter.field === 'gened') plan.filters.gened_code = filter.value.toUpperCase();
    if (filter.field === 'credits') plan.filters.credits = parseInt(filter.value);
    if (filter.field === 'level') plan.filters.level = parseInt(filter.value);
    if (filter.field === 'crn') plan.filters.crn = filter.value;
    if (filter.field === 'instructor') {
      // Would need to resolve instructor name to ID - skip for now
    }
  }

  // 6. Apply gened:any/all from parsed query
  if (clause.genedMode) {
    if (clause.genedMode.any) plan.filters.gened_any = clause.genedMode.any;
    if (clause.genedMode.all) plan.filters.gened_all = clause.genedMode.all;
  }

  // 7. Allow manual overrides from query params
  if (c.req.query('subject')) plan.filters.subject = c.req.query('subject');
  if (c.req.query('gened')) plan.filters.gened_code = c.req.query('gened');
  if (c.req.query('credits')) plan.filters.credits = parseInt(c.req.query('credits')!);

  const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 20;

  try {
    const searchStartTime = performance.now();
    const results = await hybridSearchWithTermRanking(
      c.env.DB,
      c.env.VECTORIZE,
      c.env.AI,
      plan,
      limit
    );
    const searchEndTime = performance.now();

    const totalEndTime = performance.now();

    // Calculate timing
    const extractionMs = extractionEndTime - startTime;
    const searchMs = searchEndTime - searchStartTime;
    const totalMs = totalEndTime - startTime;

    return c.json({
      results: results.map(r => ({
        ...r.course,
        _score: r.score,
        _semanticRank: r.semanticRank,
        _keywordRank: r.keywordRank,
        _historical: r.historical
      })),
      meta: {
        query: {
          raw: query,
          residual: extraction.residual,
        },
        extraction: {
          hints: extraction.hints,
        },
        plan: {
          filters: plan.filters,
          clauses: parsed.clauses,
        },
        ambiguities: plan.ambiguities,
        timing: {
          extraction_ms: Math.round(extractionMs),
          search_ms: Math.round(searchMs),
          total_ms: Math.round(totalMs),
        },
      },
      pagination: {
        total: results.length,
        limit,
        offset: 0,
      },
    });
  } catch (error) {
    console.error('Search error:', error);
    return c.json({ error: String(error) }, 500);
  }
});
