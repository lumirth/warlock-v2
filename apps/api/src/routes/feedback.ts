import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import {
  decodeFeedbackSubmitDto,
  FEEDBACK_BODY_MAX_BYTES,
  type FeedbackSubmitDto,
} from '@uiuc-course-search/query-types';
import { readBoundedJsonBody } from '../http/bounded-json-body.js';
import { errorFields, logger } from '../observability/logger.js';

type Bindings = {
  DB: D1Database;
};

export const feedbackRoutes = new Hono<{ Bindings: Bindings }>();

feedbackRoutes.post('/api/feedback', async (c) => {
  const decoded = await feedbackBody(c.req.raw);
  if ('status' in decoded) return c.json({ error: decoded.error }, decoded.status);
  try {
    return c.json(await saveFeedback(c.env.DB, decoded, c.req.header('User-Agent')), 202);
  } catch (error) {
    logger.error('route.feedback.failed', { ...errorFields(error) });
    return c.json({ error: 'feedback could not be saved' }, 500);
  }
});

type Rejection = { error: string; status: 400 | 413 | 415 };

async function feedbackBody(request: Request): Promise<FeedbackSubmitDto | Rejection> {
  if (!/^application\/(?:[\w.+-]+\+)?json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) {
    return { error: 'feedback content type must be application/json', status: 415 };
  }
  const raw = await readBoundedJsonBody(request, FEEDBACK_BODY_MAX_BYTES);
  if (!raw.ok) return raw.reason === 'too_large'
    ? { error: `feedback body must be at most ${FEEDBACK_BODY_MAX_BYTES} bytes`, status: 413 }
    : { error: 'feedback body must be valid JSON', status: 400 };
  const decoded = decodeFeedbackSubmitDto(raw.value);
  return decoded.ok ? decoded.value : { error: decoded.error, status: 400 };
}

async function saveFeedback(db: D1Database, body: FeedbackSubmitDto, userAgent?: string) {
  const id = crypto.randomUUID();
  const receivedAt = Math.floor(Date.now() / 1000);
  await db.prepare(`
    INSERT INTO feedback_events (
      id, page, query, course_id, subject, number, term, year,
      expected, message, metadata, user_agent, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, body.page, text(body.query), text(body.courseId),
    text(body.subject, 'upper'), text(body.number), text(body.term, 'lower'),
    body.year ?? null, text(body.expected), text(body.message),
    body.metadata ? JSON.stringify(body.metadata) : null,
    userAgent?.slice(0, 300) ?? null, receivedAt,
  ).run();
  return { id, status: 'accepted' as const, received_at: receivedAt };
}

function text(value: string | undefined, casing?: 'upper' | 'lower'): string | null {
  const result = value?.trim();
  if (!result) return null;
  if (casing === 'upper') return result.toUpperCase();
  if (casing === 'lower') return result.toLowerCase();
  return result;
}
