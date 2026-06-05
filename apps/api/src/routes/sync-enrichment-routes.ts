import { Hono } from 'hono';
import { SEARCH_SCOPE_VALUES } from '@uiuc-course-search/query-types';
import type { RmpTeacherNode } from '../services/rmp-sync.js';
import { createRunId, errorFields, logger } from '../observability/logger.js';
import type { SyncRouteBindings } from '../services/sync-operations.js';
import { parseBoundedIntParam, parseEnumParam } from '../http/params.js';
import {
  processRmpTeachers,
  resetGpaCursor,
  resumeGpaEnrichment,
  runGpaEnrichment,
  runRmpAndScoringEnrichment,
  runScoringEnrichment,
} from '../services/enrichment-application.js';
import { backfillCourseEmbeddings } from '../services/embedding-backfill-service.js';
import { TERMS } from '../services/sync-operations.js';

export const syncEnrichmentRoutes = new Hono<{ Bindings: SyncRouteBindings }>();

syncEnrichmentRoutes.post('/admin/sync-rmp', async (c) => {
  try {
    return c.json(await runRmpAndScoringEnrichment(c.env));
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

syncEnrichmentRoutes.post('/internal/sync-rmp-batch', async (c) => {
  const runId = createRunId('rmp-batch');
  try {
    const { teachers } = await c.req.json<{ teachers: RmpTeacherNode[] }>();

    if (!teachers || !Array.isArray(teachers) || teachers.length === 0) {
      return c.json({ error: 'No teachers provided' }, 400);
    }

    return c.json(await processRmpTeachers(c.env.DB, teachers));
  } catch (error) {
    logger.error('internal.rmpBatch.failed', { runId, ...errorFields(error) });
    return c.json({ error: String(error) }, 500);
  }
});

syncEnrichmentRoutes.post('/admin/enrich-scoring', async (c) => {
  try {
    return c.json(await runScoringEnrichment(c.env));
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

syncEnrichmentRoutes.post('/admin/enrich-gpa', async (c) => {
  try {
    return c.json(await runGpaEnrichment(c.env.DB));
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

syncEnrichmentRoutes.post('/admin/reset-gpa-sync', async (c) => {
  try {
    return c.json(await resetGpaCursor(c.env.DB, c.env.GPA_CACHE));
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

syncEnrichmentRoutes.post('/admin/sync-gpa', async (c) => {
  try {
    return c.json(await resumeGpaEnrichment(c.env.DB, c.env.GPA_CACHE));
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

syncEnrichmentRoutes.post('/admin/embeddings/backfill', async (c) => {
  const parsedScope = parseEnumParam(c.req.query('scope') ?? 'active', 'scope', SEARCH_SCOPE_VALUES);
  if (!parsedScope.ok) return c.json({ error: parsedScope.error }, 400);

  const parsedOffset = parseBoundedIntParam(c.req.query('offset'), 'offset', {
    min: 0,
    max: 100000,
    defaultValue: 0,
  });
  if (!parsedOffset.ok) return c.json({ error: parsedOffset.error }, 400);

  const parsedLimit = parseBoundedIntParam(c.req.query('limit'), 'limit', {
    min: 1,
    max: 250,
    defaultValue: 100,
  });
  if (!parsedLimit.ok) return c.json({ error: parsedLimit.error }, 400);

  const yearRaw = c.req.query('year');
  const parsedYear = yearRaw
    ? parseBoundedIntParam(yearRaw, 'year', {
      min: 2004,
      max: new Date().getFullYear() + 5,
    })
    : undefined;
  if (parsedYear && !parsedYear.ok) return c.json({ error: parsedYear.error }, 400);

  const termRaw = c.req.query('term');
  const parsedTerm = termRaw ? parseEnumParam(termRaw, 'term', TERMS) : undefined;
  if (parsedTerm && !parsedTerm.ok) return c.json({ error: parsedTerm.error }, 400);

  try {
    return c.json(await backfillCourseEmbeddings(
      c.env.DB,
      c.env.VECTORIZE,
      c.env.AI,
      {
        scope: parsedScope.value,
        limit: parsedLimit.value,
        offset: parsedOffset.value,
        year: parsedYear?.value,
        term: parsedTerm?.value,
      },
    ));
  } catch (error) {
    logger.error('admin.embeddingsBackfill.failed', { ...errorFields(error) });
    return c.json({ error: String(error) }, 500);
  }
});
