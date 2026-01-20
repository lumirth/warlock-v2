import { Hono } from 'hono';
import type { D1Database, VectorizeIndex, Ai } from '@cloudflare/workers-types';
import { searchCourses } from '../services/embeddings.js';
import { hybridSearch, keywordSearch, type SearchFilters } from '../services/search.js';

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
    const results = await searchCourses(c.env.VECTORIZE, c.env.AI, query, 20);
    return c.json({ results });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// Keyword search endpoint
searchRoutes.get('/search/keyword', async (c) => {
  const query = c.req.query('q') || '';

  const filters: SearchFilters = {
    subject: c.req.query('subject'),
    minGpa: c.req.query('min_gpa') ? parseFloat(c.req.query('min_gpa')!) : undefined,
    maxGpa: c.req.query('max_gpa') ? parseFloat(c.req.query('max_gpa')!) : undefined,
    credits: c.req.query('credits') ? parseInt(c.req.query('credits')!) : undefined,
    gened: c.req.query('gened'),
    status: c.req.query('status')
  };

  try {
    const results = await keywordSearch(c.env.DB, query, filters, 20);
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

  const filters: SearchFilters = {
    subject: c.req.query('subject'),
    minGpa: c.req.query('min_gpa') ? parseFloat(c.req.query('min_gpa')!) : undefined,
    maxGpa: c.req.query('max_gpa') ? parseFloat(c.req.query('max_gpa')!) : undefined,
    credits: c.req.query('credits') ? parseInt(c.req.query('credits')!) : undefined,
    gened: c.req.query('gened'),
    status: c.req.query('status')
  };

  const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 20;

  try {
    const results = await hybridSearch(
      c.env.DB,
      c.env.VECTORIZE,
      c.env.AI,
      query,
      filters,
      limit
    );

    return c.json({
      results: results.map(r => ({
        ...r.course,
        _score: r.score,
        _semanticRank: r.semanticRank,
        _keywordRank: r.keywordRank
      })),
      meta: {
        total: results.length,
        query
      }
    });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});
