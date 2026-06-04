import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import { parseCourseDetailHttpRequest } from '../http/course-detail-request.js';
import { errorFields, logger } from '../observability/logger.js';
import { CourseDetailService } from '../services/course-detail-service.js';

type Bindings = {
  DB: D1Database;

  // API endpoints
  CURRENT_YEAR: string;
  CURRENT_TERM: string;
  CISAPI_BASE: string;

  // Rate limiting
  BACKOFF_BASE_MS: string;
  BACKOFF_MAX_MS: string;
  MAX_RETRIES: string;

  // Caching
  CLIENT_CACHE_TTL_MS: string;
};

export const courseRoutes = new Hono<{ Bindings: Bindings }>();

// Cache/live/stale behavior belongs to CourseDetailService; the route only adapts HTTP.
courseRoutes.get('/api/course/:subject/:number', async (c) => {
  const { subject: rawSubject, number: rawNumber } = c.req.param();
  const parsed = parseCourseDetailHttpRequest({
    rawSubject,
    rawNumber,
    requestedYear: c.req.query('year'),
    requestedTerm: c.req.query('term'),
    cacheControl: c.req.header('Cache-Control'),
    fresh: c.req.query('fresh'),
  });
  if (!parsed.ok) return c.json(parsed.body, parsed.status);

  const service = new CourseDetailService(c.env);
  try {
    const result = await service.loadCourseDetail(parsed.request);

    return c.json(result.body, result.status, result.headers);
  } catch (error) {
    logger.error('route.course.failed', {
      subject: parsed.request.subject,
      number: parsed.request.number,
      ...errorFields(error),
    });
    return c.json({ error: 'Internal server error' }, 500);
  }
});
