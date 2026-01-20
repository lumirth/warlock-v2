import { Hono } from 'hono';
import type { D1Database, VectorizeIndex, Ai } from '@cloudflare/workers-types';
import { getCourseCount } from './db/index.js';
import { CISAPIClient } from './cisapi/client.js';
import { syncSubject } from './services/sync.js';
import { searchCourses } from './services/embeddings.js';
import { hybridSearch, keywordSearch, type SearchFilters } from './services/search.js';

type Bindings = {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  CURRENT_YEAR: string;
  CURRENT_TERM: string;
  CISAPI_BASE: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get('/', (c) => {
  return c.json({
    status: 'ok',
    message: 'UIUC Course Search API',
    term: `${c.env.CURRENT_TERM} ${c.env.CURRENT_YEAR}`
  });
});

app.get('/health', (c) => c.json({ healthy: true }));

app.get('/stats', async (c) => {
  const count = await getCourseCount(c.env.DB);
  return c.json({ courses: count });
});

// Test endpoint to fetch subjects from CISAPI
app.get('/test/subjects', async (c) => {
  const client = new CISAPIClient({
    baseUrl: c.env.CISAPI_BASE,
    year: c.env.CURRENT_YEAR,
    term: c.env.CURRENT_TERM
  });

  try {
    const subjects = await client.getSubjects();
    return c.json({
      count: subjects.length,
      sample: subjects.slice(0, 5)
    });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// Test endpoint to fetch a single course
app.get('/test/course/:subject/:number', async (c) => {
  const { subject, number } = c.req.param();

  const client = new CISAPIClient({
    baseUrl: c.env.CISAPI_BASE,
    year: c.env.CURRENT_YEAR,
    term: c.env.CURRENT_TERM
  });

  try {
    const course = await client.getCourseDetail(subject, number);
    return c.json(course);
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// Sync a single subject to D1
app.post('/sync/:subject', async (c) => {
  const { subject } = c.req.param();

  const client = new CISAPIClient({
    baseUrl: c.env.CISAPI_BASE,
    year: c.env.CURRENT_YEAR,
    term: c.env.CURRENT_TERM
  });

  try {
    const result = await syncSubject(c.env.DB, client, subject, {
      year: c.env.CURRENT_YEAR,
      term: c.env.CURRENT_TERM
    }, c.env.VECTORIZE, c.env.AI);

    return c.json(result);
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// Semantic search endpoint
app.get('/search/semantic', async (c) => {
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
app.get('/search/keyword', async (c) => {
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
app.get('/api/search', async (c) => {
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

export default app;
