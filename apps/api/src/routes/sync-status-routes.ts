import { Hono } from 'hono';
import { TERM_STATUS_VALUES } from '@uiuc-course-search/query-types';
import { parseEnumParam } from '../http/params.js';
import { errorFields, logger } from '../observability/logger.js';
import {
  buildSyncStatusResponse,
  listPublicTermOptions,
  listTermsForAdmin,
} from '../services/sync-status-service.js';
import type { SyncRouteBindings } from '../services/sync-operations.js';

export const syncStatusRoutes = new Hono<{ Bindings: SyncRouteBindings }>();

syncStatusRoutes.get('/api/terms', async (c) => {
  try {
    return c.json(await listPublicTermOptions(c.env.DB));
  } catch (error) {
    logger.error('route.terms.failed', { ...errorFields(error) });
    return c.json({ error: 'Term options could not be loaded' }, 500);
  }
});

syncStatusRoutes.get('/admin/sync/status', async (c) => {
  return c.json(await buildSyncStatusResponse(c.env.DB, {
    currentYear: c.env.CURRENT_YEAR,
    currentTerm: c.env.CURRENT_TERM,
  }));
});

syncStatusRoutes.get('/admin/terms', async (c) => {
  const statusRaw = c.req.query('status');

  try {
    if (statusRaw) {
      const status = parseEnumParam(statusRaw, 'status', TERM_STATUS_VALUES);
      if (!status.ok) return c.json({ error: status.error }, 400);
      return c.json(await listTermsForAdmin(c.env.DB, status.value));
    }

    return c.json(await listTermsForAdmin(c.env.DB));
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});
