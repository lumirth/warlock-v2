import { Hono } from 'hono';
import { resumeGpaSync, resetGpaSync } from '../services/gpa-sync.js';
import { enrichCoursesWithGpa, enrichCoursesWithScores, coordinateEnrichment } from '../services/enrichment.js';
import { coordinateRmpSync, processRmpBatch, RmpTeacherNode } from '../services/rmp-sync.js';
import { createRunId, errorFields, logger } from '../observability/logger.js';
import type { SyncRouteBindings } from './sync-shared.js';

export const syncEnrichmentRoutes = new Hono<{ Bindings: SyncRouteBindings }>();

syncEnrichmentRoutes.post('/admin/sync-rmp', async (c) => {
  try {
    const result = await coordinateRmpSync(c.env.DB, c.env.SELF, {
      rmpAuthToken: c.env.RMP_AUTH_TOKEN,
      internalToken: c.env.INTERNAL_TOKEN,
    });
    const enrichment = await coordinateEnrichment(c.env.DB, c.env.SELF, c.env.INTERNAL_TOKEN);
    return c.json({ ...result, enrichment });
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

    await processRmpBatch(c.env.DB, teachers);

    return c.json({ status: 'complete', message: 'Batch processed', count: teachers.length });
  } catch (error) {
    logger.error('internal.rmpBatch.failed', { runId, ...errorFields(error) });
    return c.json({ error: String(error) }, 500);
  }
});

syncEnrichmentRoutes.post('/admin/enrich-scoring', async (c) => {
  try {
    const result = await coordinateEnrichment(c.env.DB, c.env.SELF, c.env.INTERNAL_TOKEN);
    return c.json({ message: 'Scoring enrichment complete', ...result });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

syncEnrichmentRoutes.post('/admin/enrich-gpa', async (c) => {
  try {
    await enrichCoursesWithGpa(c.env.DB);
    const scores = await enrichCoursesWithScores(c.env.DB);
    return c.json({ message: 'Enrichment complete', scoreUpdateCount: scores.updated });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

syncEnrichmentRoutes.post('/admin/reset-gpa-sync', async (c) => {
  try {
    await resetGpaSync(c.env.DB, c.env.GPA_CACHE);
    return c.json({ message: 'GPA sync cursor reset to 0.' });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

syncEnrichmentRoutes.post('/admin/sync-gpa', async (c) => {
  try {
    const result = await resumeGpaSync(c.env.DB, c.env.GPA_CACHE);
    return c.json(result);
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});
