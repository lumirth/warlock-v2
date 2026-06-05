import { Hono } from 'hono';
import { getTermsByStatus } from '../db/term-state-repository.js';
import { TERM_STATUSES, type SyncState, type TermState } from '../db/types.js';
import { buildFreshnessSummary } from '../services/freshness.js';
import { parseEnumParam } from '../http/params.js';
import type { EnrichmentCoverage, SyncRouteBindings } from '../services/sync-operations.js';

export const syncStatusRoutes = new Hono<{ Bindings: SyncRouteBindings }>();

syncStatusRoutes.get('/admin/sync/status', async (c) => {
  const [syncStates, termStates, enrichmentCoverage] = await Promise.all([
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
    c.env.DB.prepare(`
      SELECT
        ts.term_id,
        ts.status,
        ts.courses_count,
        ts.sections_count,
        (
          SELECT COUNT(*)
          FROM courses c
          WHERE c.year = ts.year
            AND c.term = ts.term
            AND c.avg_gpa IS NOT NULL
        ) AS courses_with_gpa,
        (
          SELECT COUNT(*)
          FROM courses c
          WHERE c.year = ts.year
            AND c.term = ts.term
            AND c.quality_score IS NOT NULL
        ) AS courses_with_quality,
        (
          SELECT COUNT(*)
          FROM courses c
          WHERE c.year = ts.year
            AND c.term = ts.term
            AND c.difficulty_score IS NOT NULL
        ) AS courses_with_difficulty,
        (
          SELECT COUNT(*)
          FROM instructor_course_links l
          WHERE l.term_id = ts.term_id
            AND (l.gpa_id IS NOT NULL OR l.rmp_id IS NOT NULL)
        ) AS enriched_links
      FROM term_state ts
      WHERE ts.status IN ('registrable', 'active')
      ORDER BY
        CASE ts.status WHEN 'registrable' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,
        year DESC,
        CASE term WHEN 'fall' THEN 4 WHEN 'summer' THEN 3 WHEN 'spring' THEN 2 WHEN 'winter' THEN 1 ELSE 0 END DESC
    `).all<EnrichmentCoverage>(),
  ]);

  return c.json({
    generatedAt: new Date().toISOString(),
    syncStates: syncStates.results,
    termStates: termStates.results,
    enrichmentCoverage: enrichmentCoverage.results,
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

syncStatusRoutes.get('/admin/terms', async (c) => {
  const statusRaw = c.req.query('status');

  try {
    if (statusRaw) {
      const status = parseEnumParam(statusRaw, 'status', TERM_STATUSES);
      if (!status.ok) return c.json({ error: status.error }, 400);
      const terms = await getTermsByStatus(c.env.DB, status.value);
      return c.json({ terms });
    }

    const registrable = await getTermsByStatus(c.env.DB, 'registrable');
    const active = await getTermsByStatus(c.env.DB, 'active');
    const historical = await getTermsByStatus(c.env.DB, 'historical');
    return c.json({ registrable, active, historical });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});
