import { Hono } from 'hono';
import type { D1Database, VectorizeIndex, Ai } from '@cloudflare/workers-types';
import { searchCourses } from '../services/embeddings.js';
import { hybridSearch, keywordSearch } from '../services/search.js';
import { resolveQuery } from '../services/query-resolver.js';
import { extractQueryLite } from '@uiuc-course-search/query-extractor-lite';
import type { ExtractedQuery, SearchPlan } from '@uiuc-course-search/query-types';

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

// Hybrid search endpoint (combines semantic + keyword with RRF)
searchRoutes.get('/api/search', async (c) => {
  const query = c.req.query('q');
  if (!query) {
    return c.json({ error: 'Missing query parameter q' }, 400);
  }

  // 1. Get extracted query (either from client header or via server-side fallback)
  let extracted: ExtractedQuery;
  const hintsHeader = c.req.header('X-Search-Hints');
  
  if (hintsHeader) {
    try {
      extracted = JSON.parse(hintsHeader);
    } catch (e) {
      extracted = extractQueryLite(query);
    }
  } else {
    // Fallback to server-side regex extraction if client didn't provide hints
    extracted = extractQueryLite(query);
  }

  // 2. Authoritatively resolve hints to DB IDs/Codes
  const plan = await resolveQuery(c.env.DB, extracted);
  
  // 3. Allow manual overrides from query params
  if (c.req.query('subject')) plan.filters.subject = c.req.query('subject');
  if (c.req.query('gened')) plan.filters.gened_code = c.req.query('gened');
  if (c.req.query('credits')) plan.filters.credits = parseInt(c.req.query('credits')!);

  const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 20;

  try {
    const results = await hybridSearch(
      c.env.DB,
      c.env.VECTORIZE,
      c.env.AI,
      plan,
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
        plan,
        extracted
      }
    });
  } catch (error) {
    console.error('Search error:', error);
    return c.json({ error: String(error) }, 500);
  }
});
