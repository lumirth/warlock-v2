import { Hono } from 'hono';
import type { SyncRouteBindings } from '../services/sync-operations.js';
import { runEnrichment } from '../services/enrichment-application.js';
import { resetGpaSync, resumeGpaSync } from '../services/gpa-sync.js';

export const syncEnrichmentRoutes = new Hono<{ Bindings: SyncRouteBindings }>();

syncEnrichmentRoutes.post('/admin/enrich', async (c) => {
  try {
    return c.json(await runEnrichment(c.env));
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

syncEnrichmentRoutes.delete('/admin/gpa', async (c) => {
  return c.json({ result: await resetGpaSync(c.env.DB, c.env.GPA_CACHE) });
});

syncEnrichmentRoutes.post('/admin/gpa', async (c) => {
  return c.json(await resumeGpaSync(c.env.DB, c.env.GPA_CACHE));
});
