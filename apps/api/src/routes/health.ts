import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';

export const healthRoutes = new Hono<{ Bindings: { DB: D1Database } }>();

healthRoutes.get('/', async (c) => {
  const current = await c.env.DB.prepare(`
    SELECT term, year, (SELECT COUNT(owner_token) FROM sync_state) AS schema_check
    FROM term_state AS current
    WHERE status IN ('registrable', 'active')
      AND last_synced IS NOT NULL AND courses_count > 0
      AND EXISTS (
        SELECT 1 FROM courses
        WHERE year = current.year AND term = current.term
      )
    ORDER BY year DESC, CASE term WHEN 'fall' THEN 4 WHEN 'summer' THEN 3
      WHEN 'spring' THEN 2 WHEN 'winter' THEN 1 ELSE 0 END DESC LIMIT 1
  `).first<{ term: string; year: number }>();
  return c.json({
    status: 'ok',
    message: 'UIUC Course Search API',
    term: current ? `${current.term} ${current.year}` : null,
  });
});

healthRoutes.get('/health', (c) => c.json({ healthy: true }));
