import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import { SEARCH_TERM_VALUES } from '@uiuc-course-search/query-types';
import { errorFields, logger } from '../observability/logger.js';
import { loadCourseDetail } from '../services/course-detail.js';

type Bindings = {
  DB: D1Database;
};

export const courseRoutes = new Hono<{ Bindings: Bindings }>();

courseRoutes.get('/api/course/:subject/:number', async (c) => {
  const { subject: rawSubject, number: rawNumber } = c.req.param();
  const request = courseRequest(
    rawSubject,
    rawNumber,
    c.req.query('year'),
    c.req.query('term'),
  );
  if (!request) return c.json({ error: 'invalid course request' }, 400);

  try {
    const result = await loadCourseDetail(c.env.DB, request);
    return result
      ? c.json(result, 200, { 'Cache-Control': 'public, max-age=60, s-maxage=300' })
      : c.json({ error: 'Course not found' }, 404);
  } catch (error) {
    logger.error('route.course.failed', {
      subject: request.subject,
      number: request.number,
      ...errorFields(error),
    });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

function courseRequest(
  rawSubject: string,
  rawNumber: string,
  requestedYear?: string,
  requestedTerm?: string,
) {
  const subject = rawSubject.trim().toUpperCase();
  const number = rawNumber.trim();
  if (!/^[A-Z]{2,4}$/.test(subject)) return null;
  if (!/^\d{3}[A-Z]?$/.test(number)) return null;
  if (Boolean(requestedYear) !== Boolean(requestedTerm)) return null;
  if (requestedYear) {
    const year = Number(requestedYear);
    if (!Number.isInteger(year)) return null;
    if (year < 2004 || year > new Date().getFullYear() + 2) return null;
  }
  if (requestedTerm && !SEARCH_TERM_VALUES.includes(
    requestedTerm as typeof SEARCH_TERM_VALUES[number]
  )) return null;
  return { subject, number, requestedYear, requestedTerm };
}
