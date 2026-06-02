import { Hono } from 'hono';
import type { D1Database, VectorizeIndex, Ai, Fetcher, KVNamespace } from '@cloudflare/workers-types';
import { discoverAndClassifyTerms } from '../services/term-discovery.js';
import { syncTerm, syncSubjects } from '../services/parallel-sync.js';
import { validateSyncResult } from '../services/validation.js';
import { getTermsByStatus, getTermState, upsertTermState, makeTermId, type SyncState, type TermState } from '../db/index.js';
import { resumeGpaSync, resetGpaSync } from '../services/gpa-sync.js';
import { enrichCoursesWithGpa, enrichCoursesWithScores, coordinateEnrichment } from '../services/enrichment.js';
import { coordinateRmpSync, processRmpBatch, RmpTeacherNode } from '../services/rmp-sync.js';
import { buildFreshnessSummary } from '../services/freshness.js';
import { parseBoundedIntParam, parseEnumParam } from '../http/params.js';
import { createRunId, errorFields, logger } from '../observability/logger.js';

const TERMS = ['winter', 'spring', 'summer', 'fall'] as const;
const TERM_STATUSES = ['active', 'historical'] as const;
const MAX_SYNC_SUBJECTS_PER_REQUEST = 5;

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
  SYNC_EMBEDDINGS?: string;
  INTERNAL_TOKEN?: string;
  RMP_AUTH_TOKEN?: string;
};

export const syncRoutes = new Hono<{ Bindings: Bindings }>();

export function resolveManualSyncTermStatus(
  existingTerm: Pick<TermState, 'status'> | null,
  requestedStatus?: 'active' | 'historical'
): 'active' | 'historical' {
  if (requestedStatus) return requestedStatus;
  if (existingTerm?.status === 'historical') return 'historical';
  return 'active';
}

export type TermAggregateCounts = {
  subjectsCount: number;
  coursesCount: number;
  sectionsCount: number;
};

function numericCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export async function readTermAggregateCounts(
  db: D1Database,
  termId: string,
  year: number,
  term: string,
  totalSubjects: number
): Promise<TermAggregateCounts> {
  const [courses, sections] = await Promise.all([
    db.prepare(`
      SELECT COUNT(*) AS count
      FROM courses
      WHERE year = ? AND term = ?
    `).bind(year, term).first<{ count: number }>(),
    db.prepare(`
      SELECT COUNT(*) AS count
      FROM sections
      WHERE term_id = ?
    `).bind(termId).first<{ count: number }>(),
  ]);

  return {
    subjectsCount: totalSubjects,
    coursesCount: numericCount(courses?.count),
    sectionsCount: numericCount(sections?.count),
  };
}

function syncEmbeddingsEnabled(value: string | undefined): boolean {
  return value?.toLowerCase() === 'true';
}

function parseForceRunningLocks(value: string | undefined): boolean | null {
  if (value === undefined || value === '') return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

syncRoutes.get('/admin/sync/status', async (c) => {
  const [syncStates, termStates] = await Promise.all([
    c.env.DB.prepare(`
      SELECT id, last_sync, last_status, items_synced, cursor, etag
      FROM sync_state
      ORDER BY id
    `).all<SyncState>(),
    c.env.DB.prepare(`
      SELECT term_id, year, term, status, last_checked, last_synced,
             subjects_count, courses_count, sections_count, sync_errors,
             created_at, updated_at
      FROM term_state
      ORDER BY year DESC, term DESC, term_id
    `).all<TermState>(),
  ]);

  return c.json({
    generatedAt: new Date().toISOString(),
    syncStates: syncStates.results,
    termStates: termStates.results,
    unhealthySyncStates: syncStates.results.filter(state => state.last_status === 'failed'),
    runningSyncStates: syncStates.results.filter(state => state.last_status === 'running'),
    freshness: buildFreshnessSummary({
      syncStates: syncStates.results,
      termStates: termStates.results,
      nowSeconds: Math.floor(Date.now() / 1000),
      currentYear: parseInt(c.env.CURRENT_YEAR, 10),
      currentTerm: c.env.CURRENT_TERM,
    }),
  });
});

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
    return c.json({ message: 'Scoring enrichment complete', ...result });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// Admin trigger for GPA Enrichment
syncRoutes.post('/admin/enrich-gpa', async (c) => {
  try {
    await enrichCoursesWithGpa(c.env.DB);
    const scores = await enrichCoursesWithScores(c.env.DB);
    return c.json({ message: 'Enrichment complete', scoreUpdateCount: scores.updated });
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
      syncEmbeddingsEnabled(c.env.SYNC_EMBEDDINGS) ? c.env.VECTORIZE : undefined,
      syncEmbeddingsEnabled(c.env.SYNC_EMBEDDINGS) ? c.env.AI : undefined
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
    max: MAX_SYNC_SUBJECTS_PER_REQUEST,
    defaultValue: MAX_SYNC_SUBJECTS_PER_REQUEST,
  });
  if (!parsedLimit.ok) return c.json({ error: parsedLimit.error }, 400);

  const requestedStatusRaw = c.req.query('status');
  let requestedStatus: 'active' | 'historical' | undefined;
  if (requestedStatusRaw !== undefined && requestedStatusRaw !== '') {
    const parsedStatus = parseEnumParam(requestedStatusRaw, 'status', TERM_STATUSES);
    if (!parsedStatus.ok) return c.json({ error: parsedStatus.error }, 400);
    requestedStatus = parsedStatus.value;
  }

  const forceRunningLocks = parseForceRunningLocks(c.req.query('force'));
  if (forceRunningLocks === null) {
    return c.json({ error: 'force must be true or false' }, 400);
  }

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
      syncEmbeddingsEnabled(c.env.SYNC_EMBEDDINGS) ? c.env.VECTORIZE : undefined,
      syncEmbeddingsEnabled(c.env.SYNC_EMBEDDINGS) ? c.env.AI : undefined,
      { lockMode: forceRunningLocks ? 'force' : 'respect-running' }
    );

    const termId = makeTermId(parsedYear.value, parsedTerm.value);
    const existingTerm = await getTermState(c.env.DB, termId);
    const aggregateCounts = await readTermAggregateCounts(
      c.env.DB,
      termId,
      parsedYear.value,
      parsedTerm.value,
      result.pagination?.total ?? result.successfulSubjects + result.failedSubjects
    );
    await upsertTermState(c.env.DB, {
      term_id: termId,
      year: parsedYear.value,
      term: parsedTerm.value,
      status: resolveManualSyncTermStatus(existingTerm, requestedStatus),
      last_checked: Math.floor(Date.now() / 1000),
      last_synced: Math.floor(Date.now() / 1000),
      subjects_count: aggregateCounts.subjectsCount,
      courses_count: aggregateCounts.coursesCount,
      sections_count: aggregateCounts.sectionsCount,
      sync_errors: result.failedSubjects > 0
        ? JSON.stringify(result.subjectResults.filter(r => !r.success).map(r => r.error))
        : null,
    });

    const warnings = validateSyncResult(result);

    return c.json({ ...result, forceRunningLocks, warnings });
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
    max: MAX_SYNC_SUBJECTS_PER_REQUEST,
    defaultValue: MAX_SYNC_SUBJECTS_PER_REQUEST,
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
      syncEmbeddingsEnabled(c.env.SYNC_EMBEDDINGS) ? c.env.VECTORIZE : undefined,
      syncEmbeddingsEnabled(c.env.SYNC_EMBEDDINGS) ? c.env.AI : undefined
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
