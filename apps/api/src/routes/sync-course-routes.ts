import { SEARCH_TERM_VALUES } from '@uiuc-course-search/query-types';
import { Hono } from 'hono';
import { createRunId, errorFields, logger } from '../observability/logger.js';
import { syncSubjects } from '../services/parallel-sync.js';
import { coordinateCourseSync } from '../services/sync-coordinator.js';
import { discoverAndClassifyTerms } from '../services/term-discovery.js';
import { syncConcurrency, type SyncRouteBindings } from '../services/sync-operations.js';

export const syncCourseRoutes = new Hono<{ Bindings: SyncRouteBindings }>();

type Batch = { year: number; term: string; subjects: string[] };

syncCourseRoutes.post('/internal/sync-batch', async (c) => {
  const runId = createRunId('sync-batch');
  const batch = parseBatch(await c.req.json<unknown>().catch(() => null));
  if (!batch) return c.json({ error: 'invalid sync batch' }, 400);

  try {
    return c.json(await syncSubjects(
      c.env.DB,
      {
        cisapiBase: c.env.CISAPI_BASE,
        concurrency: syncConcurrency(c.env.SYNC_CONCURRENCY),
      },
      batch.year,
      batch.term,
      batch.subjects,
      c.env.VECTORIZE,
      c.env.AI,
    ));
  } catch (error) {
    logger.error('internal.syncBatch.failed', { runId, ...errorFields(error) });
    return c.json({ error: 'Internal sync batch failed', runId }, 500);
  }
});

syncCourseRoutes.post('/admin/discover-terms', async (c) => {
  try {
    const terms = await discoverAndClassifyTerms(c.env.DB, { cisapiBase: c.env.CISAPI_BASE });
    return c.json({ discovered: terms.length, terms });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

syncCourseRoutes.post('/admin/sync', async (c) => {
  const runId = createRunId('admin-course-sync');
  try {
    return c.json(await coordinateCourseSync(c.env, { runId }));
  } catch (error) {
    logger.error('admin.courseSync.failed', { runId, ...errorFields(error) });
    return c.json({ error: 'Full active-term sync failed', runId }, 500);
  }
});

function parseBatch(input: unknown): Batch | null {
  if (!input || typeof input !== 'object') return null;
  const record = input as Record<string, unknown>;
  const year = record.year;
  const term = typeof record.term === 'string' ? record.term.toLowerCase() : '';
  const subjects = Array.isArray(record.subjects)
    ? record.subjects.map(subject => typeof subject === 'string' ? subject.trim().toUpperCase() : '')
    : [];
  if (!validYear(year) || !validTerm(term) || !validSubjects(subjects)) return null;
  return { year: year as number, term, subjects };
}

function validYear(value: unknown): value is number {
  return Number.isInteger(value)
    && (value as number) >= 2004
    && (value as number) <= new Date().getFullYear() + 5;
}

function validTerm(value: string): boolean {
  return SEARCH_TERM_VALUES.includes(value as typeof SEARCH_TERM_VALUES[number]);
}

function validSubjects(subjects: string[]): boolean {
  return subjects.length > 0
    && subjects.length <= 20
    && new Set(subjects).size === subjects.length
    && subjects.every(subject => /^[A-Z]{2,4}$/.test(subject));
}
