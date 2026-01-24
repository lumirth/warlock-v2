import { Hono } from 'hono';
import type { D1Database, VectorizeIndex, Ai, Fetcher } from '@cloudflare/workers-types';
import { CISAPIClient } from '../cisapi/client.js';
import { discoverAndClassifyTerms } from '../services/term-discovery.js';
import { syncTerm, syncSubjects } from '../services/parallel-sync.js';
import { validateSyncResult } from '../services/validation.js';
import { getTermsByStatus, upsertTermState, makeTermId } from '../db/index.js';
import { resumeGpaSync, resetGpaSync, retryFailedBatches } from '../services/gpa-sync.js';
import { enrichCoursesWithGpa } from '../services/enrichment.js';
import { syncRateMyProfessorData } from '../services/rmp-sync.js';

type Bindings = {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  SELF: Fetcher;
  GPA_CACHE: KVNamespace;

  // API endpoints
  CURRENT_YEAR: string;
  CURRENT_TERM: string;
  CISAPI_BASE: string;
  FRONTEND_BASE: string;

  // Sync settings
  SYNC_CONCURRENCY: string;
};

export const syncRoutes = new Hono<{ Bindings: Bindings }>();

// Admin trigger for Retry Failures
syncRoutes.post('/admin/retry-gpa-failures', async (c) => {
  try {
    const result = await retryFailedBatches(c.env.DB);
    return c.json(result);
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// Admin trigger for RMP Sync
syncRoutes.post('/admin/sync-rmp', async (c) => {
  try {
    const result = await syncRateMyProfessorData(c.env.DB);
    return c.json(result);
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// Admin trigger for GPA Enrichment
syncRoutes.post('/admin/enrich-gpa', async (c) => {
  try {
    // Fire and forget (or await if you want to see logs)
    // Enrichment can take time, so better to use waitUntil if it gets too long,
    // but for debugging we'll await it to see immediate errors.
    await enrichCoursesWithGpa(c.env.DB);
    return c.json({ message: 'Enrichment complete' });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// Admin trigger: Reset GPA Sync Cursor
syncRoutes.post('/admin/reset-gpa-sync', async (c) => {
  try {
    await resetGpaSync(c.env.DB, c.env.GPA_CACHE as any);
    return c.json({ message: 'GPA sync cursor reset to 0.' });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// Admin trigger: Resume GPA Sync (Process next chunk)
syncRoutes.post('/admin/sync-gpa', async (c) => {
  try {
    const result = await resumeGpaSync(c.env.DB, c.env.GPA_CACHE as any);
    return c.json(result);
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// Internal batch sync endpoint (Fan-Out Worker)
syncRoutes.post('/internal/sync-batch', async (c) => {
  // Only allow internal calls (verify if needed, but Service Bindings are secure by default if not exposed)
  // For extra security in HTTP mode, check a shared secret header if exposed to internet
  // But here we assume this is called via Service Binding or internal dispatch

  try {
    const { year, term, subjects } = await c.req.json<{ year: number; term: string; subjects: string[] }>();

    if (!subjects || !Array.isArray(subjects) || subjects.length === 0) {
      return c.json({ error: 'No subjects provided' }, 400);
    }

    const config = {
      cisapiBase: c.env.CISAPI_BASE,
      concurrency: parseInt(c.env.SYNC_CONCURRENCY) || 25,
      offset: 0,
      limit: subjects.length,
    };

    console.log(`[Batch Worker] Syncing ${subjects.length} subjects: ${subjects.join(', ')}`);

    const result = await syncSubjects(
      c.env.DB,
      config,
      year,
      term,
      subjects,
      c.env.VECTORIZE,
      c.env.AI
    );

    return c.json(result);
  } catch (error) {
    console.error('[Batch Worker] Error:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Term discovery endpoint
syncRoutes.post('/admin/discover-terms', async (c) => {
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
syncRoutes.get('/admin/terms', async (c) => {
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
syncRoutes.post('/admin/sync/:year/:term', async (c) => {
  const { year, term } = c.req.param();
  const offset = parseInt(c.req.query('offset') || '0');
  const limit = parseInt(c.req.query('limit') || '40'); // Default to 40 for efficiency

  const config = {
    cisapiBase: c.env.CISAPI_BASE,
    concurrency: parseInt(c.env.SYNC_CONCURRENCY) || 25,
    offset,
    limit,
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

    const warnings = validateSyncResult(result);

    return c.json({ ...result, warnings });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// Sync all active terms (paginated - caller should iterate with offset/limit)
syncRoutes.post('/admin/sync-active', async (c) => {
  const activeTerms = await getTermsByStatus(c.env.DB, 'active');

  if (activeTerms.length === 0) {
    return c.json({ message: 'No active terms found. Run /admin/discover-terms first.' });
  }

  const offset = parseInt(c.req.query('offset') || '0');
  const limit = parseInt(c.req.query('limit') || '40'); // Default to 40

  const config = {
    cisapiBase: c.env.CISAPI_BASE,
    concurrency: parseInt(c.env.SYNC_CONCURRENCY) || 25,
    offset,
    limit,
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

    const warnings = validateSyncResult(result);
    results.push({ ...result, warnings });

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
