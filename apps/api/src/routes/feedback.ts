import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import { decodeFeedbackSubmitDto } from '@uiuc-course-search/query-types';
import { errorFields, logger } from '../observability/logger.js';
import { submitFeedback } from '../services/feedback-service.js';

type Bindings = {
  DB: D1Database;
};

export const feedbackRoutes = new Hono<{ Bindings: Bindings }>();

feedbackRoutes.post('/api/feedback', async (c) => {
  let rawBody: unknown;

  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'feedback body must be valid JSON' }, 400);
  }

  const decoded = decodeFeedbackSubmitDto(rawBody);
  if (!decoded.ok) {
    return c.json({ error: decoded.error }, 400);
  }

  try {
    const response = await submitFeedback({
      db: c.env.DB,
      body: decoded.value,
      userAgent: c.req.header('User-Agent'),
    });
    return c.json(response, 202);
  } catch (error) {
    logger.error('route.feedback.failed', { ...errorFields(error) });
    return c.json({ error: 'feedback could not be saved' }, 500);
  }
});
