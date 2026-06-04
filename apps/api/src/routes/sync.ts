import { Hono } from 'hono';
import { syncCourseRoutes } from './sync-course-routes.js';
import { syncEnrichmentRoutes } from './sync-enrichment-routes.js';
import { syncStatusRoutes } from './sync-status-routes.js';
import type { SyncRouteBindings } from './sync-shared.js';

export {
  readTermAggregateCounts,
  resolveManualSyncTermStatus,
} from './sync-shared.js';

export const syncRoutes = new Hono<{ Bindings: SyncRouteBindings }>();

syncRoutes.route('/', syncStatusRoutes);
syncRoutes.route('/', syncEnrichmentRoutes);
syncRoutes.route('/', syncCourseRoutes);
