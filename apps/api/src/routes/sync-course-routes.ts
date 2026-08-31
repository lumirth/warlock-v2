import { Hono } from 'hono';
import { createRunId, errorFields, logger } from '../observability/logger.js';
import { coordinateCourseSync } from '../services/sync-coordinator.js';
import { discoverAndClassifyTerms } from '../services/term-discovery.js';
import type { SyncRouteBindings } from '../services/sync-operations.js';

export const syncCourseRoutes = new Hono<{ Bindings: SyncRouteBindings }>();

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
