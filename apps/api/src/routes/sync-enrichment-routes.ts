import { Hono } from 'hono';
import type { RmpTeacherNode } from '../services/rmp-sync.js';
import { createRunId, errorFields, logger } from '../observability/logger.js';
import type { SyncRouteBindings } from '../services/sync-operations.js';
import {
  processRmpTeachers,
  resetGpaCursor,
  resumeGpaEnrichment,
  runGpaEnrichment,
  runRmpAndScoringEnrichment,
  runScoringEnrichment,
} from '../services/enrichment-application.js';

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
