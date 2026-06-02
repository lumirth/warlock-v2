import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import type {
  FeedbackIssue,
  FeedbackKind,
  FeedbackResponseDto,
  FeedbackSubmitDto,
} from '@uiuc-course-search/query-types';
import { errorFields, logger } from '../observability/logger.js';

type Bindings = {
  DB: D1Database;
};

const FEEDBACK_KINDS: ReadonlySet<FeedbackKind> = new Set([
  'search_results',
  'course_result',
  'score',
  'external_link',
  'data_freshness',
  'copy_confusion',
  'other',
]);

const FEEDBACK_ISSUES: ReadonlySet<FeedbackIssue> = new Set([
  'expected_different_results',
  'missing_course',
  'wrong_score',
  'broken_link',
  'stale_data',
  'confusing_copy',
  'other',
]);

const MAX_QUERY_LENGTH = 500;
const MAX_EXPECTED_LENGTH = 1000;
const MAX_MESSAGE_LENGTH = 2000;

export const feedbackRoutes = new Hono<{ Bindings: Bindings }>();

feedbackRoutes.post('/api/feedback', async (c) => {
  let body: FeedbackSubmitDto;

  try {
    body = await c.req.json<FeedbackSubmitDto>();
  } catch {
    return c.json({ error: 'feedback body must be valid JSON' }, 400);
  }

  const validationError = validateFeedback(body);
  if (validationError) {
    return c.json({ error: validationError }, 400);
  }

  const id = crypto.randomUUID();
  const receivedAt = Math.floor(Date.now() / 1000);

  try {
    await c.env.DB.prepare(`
      INSERT INTO feedback_events (
        id,
        kind,
        issue,
        page,
        query,
        course_id,
        subject,
        number,
        term,
        year,
        crn,
        instructor_name,
        score_field,
        expected,
        message,
        anonymous_session_id,
        metadata,
        user_agent,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      body.kind,
      body.issue,
      body.page,
      optionalString(body.query, MAX_QUERY_LENGTH),
      optionalString(body.courseId, 200),
      optionalString(body.subject, 20)?.toUpperCase() ?? null,
      optionalString(body.number, 20),
      optionalString(body.term, 20)?.toLowerCase() ?? null,
      typeof body.year === 'number' ? body.year : null,
      optionalString(body.crn, 20),
      optionalString(body.instructorName, 200),
      optionalString(body.scoreField, 20),
      optionalString(body.expected, MAX_EXPECTED_LENGTH),
      optionalString(body.message, MAX_MESSAGE_LENGTH),
      optionalString(body.anonymousSessionId, 200),
      body.metadata ? JSON.stringify(body.metadata) : null,
      optionalString(c.req.header('User-Agent'), 300),
      receivedAt
    ).run();

    const response: FeedbackResponseDto = {
      id,
      status: 'accepted',
      received_at: receivedAt,
    };

    return c.json(response, 202);
  } catch (error) {
    logger.error('route.feedback.failed', { ...errorFields(error) });
    return c.json({ error: 'feedback could not be saved' }, 500);
  }
});

function validateFeedback(body: FeedbackSubmitDto): string | null {
  if (!body || typeof body !== 'object') {
    return 'feedback body must be an object';
  }

  if (!FEEDBACK_KINDS.has(body.kind)) {
    return 'kind is not supported';
  }

  if (!FEEDBACK_ISSUES.has(body.issue)) {
    return 'issue is not supported';
  }

  if (body.page !== 'search' && body.page !== 'course') {
    return 'page must be search or course';
  }

  if (body.query && body.query.length > MAX_QUERY_LENGTH) {
    return `query must be at most ${MAX_QUERY_LENGTH} characters`;
  }

  if (body.expected && body.expected.length > MAX_EXPECTED_LENGTH) {
    return `expected must be at most ${MAX_EXPECTED_LENGTH} characters`;
  }

  if (body.message && body.message.length > MAX_MESSAGE_LENGTH) {
    return `message must be at most ${MAX_MESSAGE_LENGTH} characters`;
  }

  if (body.year !== undefined && (!Number.isInteger(body.year) || body.year < 2004 || body.year > new Date().getFullYear() + 2)) {
    return 'year is outside the supported range';
  }

  return null;
}

function optionalString(value: string | null | undefined, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, maxLength);
}
