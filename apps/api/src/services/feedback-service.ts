import type { D1Database } from '@cloudflare/workers-types';
import type { FeedbackResponseDto, FeedbackSubmitDto } from '@uiuc-course-search/query-types';
import { insertFeedbackEvent, type FeedbackEventRecord } from '../db/feedback-repository.js';

const MAX_QUERY_LENGTH = 500;
const MAX_EXPECTED_LENGTH = 1000;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_USER_AGENT_LENGTH = 300;

type SubmitFeedbackInput = {
  db: D1Database;
  body: FeedbackSubmitDto;
  userAgent?: string | null;
  nowSeconds?: number;
  idFactory?: () => string;
};

export async function submitFeedback({
  db,
  body,
  userAgent,
  nowSeconds = Math.floor(Date.now() / 1000),
  idFactory = () => crypto.randomUUID(),
}: SubmitFeedbackInput): Promise<FeedbackResponseDto> {
  const id = idFactory();
  await insertFeedbackEvent(db, feedbackSubmitToRecord({
    id,
    body,
    userAgent,
    createdAt: nowSeconds,
  }));

  return {
    id,
    status: 'accepted',
    received_at: nowSeconds,
  };
}

function feedbackSubmitToRecord({
  id,
  body,
  userAgent,
  createdAt,
}: {
  id: string;
  body: FeedbackSubmitDto;
  userAgent?: string | null;
  createdAt: number;
}): FeedbackEventRecord {
  return {
    id,
    kind: body.kind,
    issue: body.issue,
    page: body.page,
    query: optionalString(body.query, MAX_QUERY_LENGTH),
    courseId: optionalString(body.courseId, 200),
    subject: optionalString(body.subject, 20)?.toUpperCase() ?? null,
    number: optionalString(body.number, 20),
    term: optionalString(body.term, 20)?.toLowerCase() ?? null,
    year: typeof body.year === 'number' ? body.year : null,
    crn: optionalString(body.crn, 20),
    instructorName: optionalString(body.instructorName, 200),
    scoreField: optionalString(body.scoreField, 20),
    expected: optionalString(body.expected, MAX_EXPECTED_LENGTH),
    message: optionalString(body.message, MAX_MESSAGE_LENGTH),
    anonymousSessionId: optionalString(body.anonymousSessionId, 200),
    metadata: body.metadata ? JSON.stringify(body.metadata) : null,
    userAgent: optionalString(userAgent, MAX_USER_AGENT_LENGTH),
    createdAt,
  };
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
