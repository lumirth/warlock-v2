import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import {
  decodeFeedbackSubmitDto,
  FEEDBACK_BODY_MAX_BYTES,
} from '@uiuc-course-search/query-types';
import { readBoundedJsonBody } from '../http/bounded-json-body.js';
import { errorFields, logger } from '../observability/logger.js';
import { submitFeedback } from '../services/feedback-service.js';

type Bindings = {
  DB: D1Database;
};

export const feedbackRoutes = new Hono<{ Bindings: Bindings }>();

feedbackRoutes.post('/api/feedback', async (c) => {
  const contentType = c.req.header('Content-Type') ?? '';
  if (!/^application\/(?:[\w.+-]+\+)?json(?:\s*;|$)/i.test(contentType)) {
    return c.json({ error: 'feedback content type must be application/json' }, 415);
  }

  const rawBody = await readBoundedJsonBody(
    c.req.raw,
    FEEDBACK_BODY_MAX_BYTES,
  );
  if (!rawBody.ok && rawBody.reason === 'too_large') {
    return c.json({
      error: `feedback body must be at most ${FEEDBACK_BODY_MAX_BYTES} bytes`,
    }, 413);
  }
  if (!rawBody.ok) {
    return c.json({ error: 'feedback body must be valid JSON' }, 400);
  }

  const decoded = decodeFeedbackSubmitDto(rawBody.value);
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
