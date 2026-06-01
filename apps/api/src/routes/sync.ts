import { Hono } from 'hono';
import type { D1Database, VectorizeIndex, Ai, Fetcher, KVNamespace } from '@cloudflare/workers-types';
import { discoverAndClassifyTerms } from '../services/term-discovery.js';
import { syncTerm, syncSubjects } from '../services/parallel-sync.js';
import { validateSyncResult } from '../services/validation.js';
import { getTermsByStatus, upsertTermState, makeTermId } from '../db/index.js';
import { resumeGpaSync, resetGpaSync } from '../services/gpa-sync.js';
import { enrichCoursesWithGpa, coordinateEnrichment, processEnrichmentBatch, EnrichmentTask } from '../services/enrichment.js';
import { coordinateRmpSync, processRmpBatch, RmpTeacherNode } from '../services/rmp-sync.js';
import { parseBoundedIntParam, parseEnumParam } from '../http/params.js';
import { createRunId, errorFields, logger } from '../observability/logger.js';

const TERMS = ['winter', 'spring', 'summer', 'fall'] as const;

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
  INTERNAL_TOKEN?: string;
  RMP_AUTH_TOKEN?: string;
};

export const syncRoutes = new Hono<{ Bindings: Bindings }>();

// Admin trigger for RMP Sync
syncRoutes.post('/admin/sync-rmp', async (c) => {
  try {
    const result = await coordinateRmpSync(c.env.DB, c.env.SELF, {
      rmpAuthToken: c.env.RMP_AUTH_TOKEN,
      internalToken: c.env.INTERNAL_TOKEN,
    });
    return c.json(result);
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// Internal batch sync endpoint for RMP
syncRoutes.post('/internal/sync-rmp-batch', async (c) => {
  const runId = createRunId('rmp-batch');
  try {
    const { teachers } = await c.req.json<{ teachers: RmpTeacherNode[] }>();

    if (!teachers || !Array.isArray(teachers) || teachers.length === 0) {
      return c.json({ error: 'No teachers provided' }, 400);
    }

    c.executionCtx.waitUntil((async () => {
      try {
        await processRmpBatch(c.env.DB, teachers);
      } catch (err) {
        logger.error('internal.rmpBatch.backgroundFailed', { runId, teacherCount: teachers.length, ...errorFields(err) });
      }
    })());

    return c.json({ status: 'processing', message: 'Batch accepted', count: teachers.length }, 202);
  } catch (error) {
    logger.error('internal.rmpBatch.failed', { runId, ...errorFields(error) });
    return c.json({ error: String(error) }, 500);
  }
});

// Admin trigger for Contextual Scoring (Coordinator)
syncRoutes.post('/admin/enrich-scoring', async (c) => {
  try {
    const result = await coordinateEnrichment(c.env.DB, c.env.SELF, c.env.INTERNAL_TOKEN);
    return c.json({ message: 'Scoring enrichment dispatched', ...result });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// Internal batch sync endpoint for Enrichment
syncRoutes.post('/internal/enrich-batch', async (c) => {
  const runId = createRunId('enrich-batch');
  try {
    const { tasks } = await c.req.json<{ tasks: EnrichmentTask[] }>();

    if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
      return c.json({ error: 'No tasks provided' }, 400);
    }

    c.executionCtx.waitUntil((async () => {
      try {
        await processEnrichmentBatch(c.env.DB, tasks);
      } catch (err) {
        logger.error('internal.enrichmentBatch.backgroundFailed', { runId, taskCount: tasks.length, ...errorFields(err) });
      }
    })());

    return c.json({ status: 'processing', message: 'Batch accepted', count: tasks.length }, 202);
  } catch (error) {
    logger.error('internal.enrichmentBatch.failed', { runId, ...errorFields(error) });
    return c.json({ error: String(error) }, 500);
  }
});

// Admin trigger for GPA Enrichment
syncRoutes.post('/admin/enrich-gpa', async (c) => {
  try {
    await enrichCoursesWithGpa(c.env.DB);
    return c.json({ message: 'Enrichment complete' });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// Admin trigger: Reset GPA Sync Cursor
syncRoutes.post('/admin/reset-gpa-sync', async (c) => {
  try {
    await resetGpaSync(c.env.DB, c.env.GPA_CACHE);
    return c.json({ message: 'GPA sync cursor reset to 0.' });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// Admin trigger: Resume GPA Sync (Process next chunk)
syncRoutes.post('/admin/sync-gpa', async (c) => {
  try {
    const result = await resumeGpaSync(c.env.DB, c.env.GPA_CACHE);
    return c.json(result);
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// Internal batch sync endpoint (Fan-Out Worker)
syncRoutes.post('/internal/sync-batch', async (c) => {
  const runId = createRunId('sync-batch');
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

    logger.info('internal.syncBatch.start', { runId, year, term, subjectCount: subjects.length });

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
    logger.error('internal.syncBatch.failed', { runId, ...errorFields(error) });
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
  const parsedYear = parseBoundedIntParam(year, 'year', { min: 2004, max: new Date().getFullYear() + 2 });
  if (!parsedYear.ok) return c.json({ error: parsedYear.error }, 400);

  const parsedTerm = parseEnumParam(term, 'term', TERMS);
  if (!parsedTerm.ok) return c.json({ error: parsedTerm.error }, 400);

  const parsedOffset = parseBoundedIntParam(c.req.query('offset'), 'offset', {
    min: 0,
    max: 10000,
    defaultValue: 0,
  });
  if (!parsedOffset.ok) return c.json({ error: parsedOffset.error }, 400);

  const parsedLimit = parseBoundedIntParam(c.req.query('limit'), 'limit', {
    min: 1,
    max: 40,
    defaultValue: 40,
  });
  if (!parsedLimit.ok) return c.json({ error: parsedLimit.error }, 400);

  const config = {
    cisapiBase: c.env.CISAPI_BASE,
    concurrency: parseInt(c.env.SYNC_CONCURRENCY) || 25,
    offset: parsedOffset.value,
    limit: parsedLimit.value,
  };

  try {
    const result = await syncTerm(
      c.env.DB,
      config,
      parsedYear.value,
      parsedTerm.value,
      c.env.VECTORIZE,
      c.env.AI
    );

    await upsertTermState(c.env.DB, {
      term_id: makeTermId(parsedYear.value, parsedTerm.value),
      year: parsedYear.value,
      term: parsedTerm.value,
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

// Sync all active terms
syncRoutes.post('/admin/sync-active', async (c) => {
  const activeTerms = await getTermsByStatus(c.env.DB, 'active');

  if (activeTerms.length === 0) {
    return c.json({ message: 'No active terms found. Run /admin/discover-terms first.' });
  }

  const parsedOffset = parseBoundedIntParam(c.req.query('offset'), 'offset', {
    min: 0,
    max: 10000,
    defaultValue: 0,
  });
  if (!parsedOffset.ok) return c.json({ error: parsedOffset.error }, 400);

  const parsedLimit = parseBoundedIntParam(c.req.query('limit'), 'limit', {
    min: 1,
    max: 40,
    defaultValue: 40,
  });
  if (!parsedLimit.ok) return c.json({ error: parsedLimit.error }, 400);

  const config = {
    cisapiBase: c.env.CISAPI_BASE,
    concurrency: parseInt(c.env.SYNC_CONCURRENCY) || 25,
    offset: parsedOffset.value,
    limit: parsedLimit.value,
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
