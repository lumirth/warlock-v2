import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import { getCourseCount, getSectionCount } from '../db/index.js';

type Bindings = {
  DB: D1Database;
  CURRENT_YEAR: string;
  CURRENT_TERM: string;
};

export const healthRoutes = new Hono<{ Bindings: Bindings }>();

healthRoutes.get('/', (c) => {
  return c.json({
    status: 'ok',
    message: 'UIUC Course Search API',
    term: `${c.env.CURRENT_TERM} ${c.env.CURRENT_YEAR}`
  });
});

healthRoutes.get('/health', (c) => c.json({ healthy: true }));

healthRoutes.get('/stats', async (c) => {
  const count = await getCourseCount(c.env.DB);
  return c.json({ courses: count });
});

healthRoutes.get('/health/data', async (c) => {
  const courses = await getCourseCount(c.env.DB);
  const sections = await getSectionCount(c.env.DB);

  const healthy = courses > 1000 && sections > 0 && (sections / courses) > 1;

  return c.json({
    healthy,
    courses,
    sections,
    sectionsPerCourse: courses > 0 ? (sections / courses).toFixed(1) : '0',
    warning: sections === 0 ? 'No sections in database' : null
  }, healthy ? 200 : 500);
});
