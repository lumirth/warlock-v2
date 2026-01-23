import { Hono } from 'hono';
import type { D1Database, VectorizeIndex, Ai } from '@cloudflare/workers-types';
import { searchCourses } from '../services/embeddings.js';
import { SearchPipeline } from '../services/search-pipeline.js';
import type { SearchFilters } from '@uiuc-course-search/query-types';

type Bindings = {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
};

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

  const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 20;

  // Manual overrides from query params
  const overrides: Partial<SearchFilters> = {};
  if (c.req.query('subject')) overrides.subject = c.req.query('subject');
  if (c.req.query('gened')) overrides.gened_code = c.req.query('gened');
  if (c.req.query('credits')) overrides.credits = parseInt(c.req.query('credits')!);

  try {
    const pipeline = new SearchPipeline(c.env.DB, c.env.VECTORIZE, c.env.AI);
    const result = await pipeline.search(query, limit, overrides, c.executionCtx.waitUntil.bind(c.executionCtx));

    return c.json({
      results: result.results.map(r => ({
        ...r.course,
        _score: r.score,
        _semanticRank: r.semanticRank,
        _keywordRank: r.keywordRank,
        _historical: r.historical
      })),
      meta: {
        ...result.meta,
        ambiguities: result.meta.plan.ambiguities,
      },
      pagination: {
        total: result.results.length,
        limit,
        offset: 0,
      },
    });
  } catch (error) {
    console.error('Search error:', error);
    return c.json({ error: String(error) }, 500);
  }
});
