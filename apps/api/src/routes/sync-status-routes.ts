import type { D1Database } from '@cloudflare/workers-types';
import {
  type SearchTermFilter,
  type SearchTermOptionsDto,
  type TermStatus,
} from '@warlock-v2/query-types';
import { Hono } from 'hono';
import { errorFields, logger } from '../observability/logger.js';
import type { SyncRouteBindings } from '../services/sync-operations.js';

export const syncStatusRoutes = new Hono<{ Bindings: SyncRouteBindings }>();
const TERM_ORDER = `year DESC, CASE term
  WHEN 'fall' THEN 4 WHEN 'summer' THEN 3 WHEN 'spring' THEN 2 WHEN 'winter' THEN 1 ELSE 0 END DESC`;
const LABELS = { winter: 'Winter', spring: 'Spring', summer: 'Summer', fall: 'Fall' } as const;

syncStatusRoutes.get('/api/terms', async (c) => {
  try {
    return c.json(await publicTerms(c.env.DB));
  } catch (error) {
    logger.error('route.terms.failed', errorFields(error));
    return c.json({ error: 'Term options could not be loaded' }, 500);
  }
});

syncStatusRoutes.get('/admin/sync/status', async (c) => {
  const [terms, jobs, subjects] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM term_state ORDER BY ${TERM_ORDER}`).all(),
    c.env.DB.prepare('SELECT * FROM sync_state ORDER BY id').all(),
    c.env.DB.prepare(`
      SELECT term_id, subject, last_sync, status, courses_synced, sections_synced, error
      FROM subject_sync_state WHERE status != 'complete' ORDER BY term_id, subject
    `).all(),
  ]);
  return c.json({
    generatedAt: new Date().toISOString(),
    terms: terms.results,
    jobs: jobs.results,
    incompleteSubjects: subjects.results,
  });
});

async function publicTerms(db: D1Database): Promise<SearchTermOptionsDto> {
  const result = await db.prepare(`
    SELECT term_id, year, term, status FROM term_state
    WHERE status IN ('registrable', 'active', 'historical') ORDER BY ${TERM_ORDER}
  `).all<{ term_id: string; year: number; term: SearchTermFilter; status: TermStatus }>();
  const terms = result.results.map(row => ({
    termId: row.term_id,
    year: row.year,
    term: row.term,
    status: row.status,
    label: `${LABELS[row.term]} ${row.year}`,
  }));
  return { terms };
}
