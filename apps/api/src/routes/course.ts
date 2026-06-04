import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import { parseBoundedIntParam, parseCourseNumberParam, parseEnumParam, parseSubjectParam } from '../http/params.js';
import { errorFields, logger } from '../observability/logger.js';
import { CourseDetailService } from '../services/course-detail-service.js';

const TERMS = ['winter', 'spring', 'summer', 'fall'] as const;

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

// Fresh fetch for a single course returns live CISAPI data without mutating canonical DB tables.
courseRoutes.get('/api/course/:subject/:number', async (c) => {
  const { subject: rawSubject, number: rawNumber } = c.req.param();
  const parsedSubject = parseSubjectParam(rawSubject);
  if (!parsedSubject.ok) return c.json({ error: parsedSubject.error }, 400);

  const parsedNumber = parseCourseNumberParam(rawNumber);
  if (!parsedNumber.ok) return c.json({ error: parsedNumber.error }, 400);

  const requestedYear = c.req.query('year');
  const requestedTerm = c.req.query('term');
  if ((requestedYear && !requestedTerm) || (!requestedYear && requestedTerm)) {
    return c.json({ error: 'year and term must be provided together' }, 400);
  }

  if (requestedYear) {
    const parsedYear = parseBoundedIntParam(requestedYear, 'year', { min: 2004, max: new Date().getFullYear() + 2 });
    if (!parsedYear.ok) return c.json({ error: parsedYear.error }, 400);
  }

  if (requestedTerm) {
    const parsedTerm = parseEnumParam(requestedTerm, 'term', TERMS);
    if (!parsedTerm.ok) return c.json({ error: parsedTerm.error }, 400);
  }

  const service = new CourseDetailService(c.env);
  try {
    const result = await service.loadCourseDetail({
      subject: parsedSubject.value,
      number: parsedNumber.value,
      requestedYear,
      requestedTerm,
      bypassCache: c.req.header('Cache-Control')?.includes('no-cache') || c.req.query('fresh') === 'true',
    });

    return c.json(result.body, result.status, result.headers);
  } catch (error) {
    logger.error('route.course.failed', {
      subject: parsedSubject.value,
      number: parsedNumber.value,
      ...errorFields(error),
    });
    return c.json({ error: 'Internal server error' }, 500);
  }
});
