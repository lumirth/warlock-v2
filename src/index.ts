import { Hono } from 'hono';
import type { D1Database, VectorizeIndex, Ai } from '@cloudflare/workers-types';
import { getCourseCount } from './db/index.js';
import { CISAPIClient } from './cisapi/client.js';
import { syncSubject } from './services/sync.js';
import { searchCourses } from './services/embeddings.js';
import { hybridSearch, keywordSearch, type SearchFilters } from './services/search.js';
import { discoverAndClassifyTerms } from './services/term-discovery.js';
import { syncTerm } from './services/parallel-sync.js';
import { getTermsByStatus, getTermState, upsertTermState, makeTermId } from './db/index.js';
import { getRateLimiter, resetRateLimiter } from './services/rate-limiter.js';

type Bindings = {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;

  // API endpoints
  CURRENT_YEAR: string;
  CURRENT_TERM: string;
  CISAPI_BASE: string;
  FRONTEND_BASE: string;

  // Sync settings
  SYNC_INTERVAL_MS: string;
  SYNC_CONCURRENCY: string;
  TERM_CHECK_INTERVAL_MS: string;

  // Rate limiting
  BACKOFF_BASE_MS: string;
  BACKOFF_MAX_MS: string;
  MAX_RETRIES: string;

  // Caching
  CLIENT_CACHE_TTL_MS: string;
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

// Term discovery endpoint
app.post('/admin/discover-terms', async (c) => {
  const config = {
    frontendBase: c.env.FRONTEND_BASE,
    cisapiBase: c.env.CISAPI_BASE,
  };

  try {
    const classifications = await discoverAndClassifyTerms(c.env.DB, config);
    return c.json({
      discovered: classifications.length,
      terms: classifications.map(cl => ({
        termId: cl.term.termId,
        year: cl.term.year,
        term: cl.term.term,
        status: cl.status,
        sampleStatuses: cl.sampleEnrollmentStatuses
      }))
    });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// Get term states
app.get('/admin/terms', async (c) => {
  const status = c.req.query('status') as 'active' | 'historical' | undefined;

  try {
    if (status) {
      const terms = await getTermsByStatus(c.env.DB, status);
      return c.json({ terms });
    }

    const active = await getTermsByStatus(c.env.DB, 'active');
    const historical = await getTermsByStatus(c.env.DB, 'historical');
    return c.json({ active, historical });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// Sync a specific term
app.post('/admin/sync/:year/:term', async (c) => {
  const { year, term } = c.req.param();

  const config = {
    cisapiBase: c.env.CISAPI_BASE,
    concurrency: parseInt(c.env.SYNC_CONCURRENCY) || 25,
  };

  try {
    const result = await syncTerm(
      c.env.DB,
      config,
      parseInt(year),
      term,
      c.env.VECTORIZE,
      c.env.AI
    );

    await upsertTermState(c.env.DB, {
      term_id: makeTermId(parseInt(year), term),
      year: parseInt(year),
      term,
      status: 'active',
      last_checked: Math.floor(Date.now() / 1000),
      last_synced: Math.floor(Date.now() / 1000),
      subjects_count: result.successfulSubjects + result.failedSubjects,
      courses_count: result.totalCourses,
      sections_count: result.totalSections,
      sync_errors: result.failedSubjects > 0
        ? JSON.stringify(result.subjectResults.filter(r => !r.success).map(r => r.error))
        : null,
    });

    return c.json(result);
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// Sync all active terms
app.post('/admin/sync-active', async (c) => {
  const activeTerms = await getTermsByStatus(c.env.DB, 'active');

  if (activeTerms.length === 0) {
    return c.json({ message: 'No active terms found. Run /admin/discover-terms first.' });
  }

  const config = {
    cisapiBase: c.env.CISAPI_BASE,
    concurrency: parseInt(c.env.SYNC_CONCURRENCY) || 25,
  };

  const results = [];
  for (const termState of activeTerms) {
    const result = await syncTerm(
      c.env.DB,
      config,
      termState.year,
      termState.term,
      c.env.VECTORIZE,
      c.env.AI
    );
    results.push(result);

    await upsertTermState(c.env.DB, {
      ...termState,
      last_synced: Math.floor(Date.now() / 1000),
      courses_count: result.totalCourses,
      sections_count: result.totalSections,
      sync_errors: result.failedSubjects > 0
        ? JSON.stringify(result.subjectResults.filter(r => !r.success).map(r => r.error))
        : null,
    });
  }

  return c.json({ results });
});

// Rate limiter status
app.get('/admin/rate-limit-status', (c) => {
  const rateLimiter = getRateLimiter({
    backoffBaseMs: parseInt(c.env.BACKOFF_BASE_MS) || 5000,
    backoffMaxMs: parseInt(c.env.BACKOFF_MAX_MS) || 60000,
    maxRetries: parseInt(c.env.MAX_RETRIES) || 3,
  });

  const state = rateLimiter.getState();
  const errorMessage = rateLimiter.getErrorMessage();
  const staleWarning = rateLimiter.getStaleDataWarning();

  return c.json({
    ...state,
    errorMessage,
    staleWarning,
  });
});

// Reset rate limiter
app.post('/admin/reset-rate-limiter', (c) => {
  resetRateLimiter();
  return c.json({ message: 'Rate limiter reset' });
});

export default app;
