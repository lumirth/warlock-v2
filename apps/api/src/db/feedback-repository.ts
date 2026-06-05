import type { D1Database } from '@cloudflare/workers-types';

export type FeedbackEventRecord = {
  id: string;
  kind: string;
  issue: string;
  page: string;
  query: string | null;
  courseId: string | null;
  subject: string | null;
  number: string | null;
  term: string | null;
  year: number | null;
  crn: string | null;
  instructorName: string | null;
  scoreField: string | null;
  expected: string | null;
  message: string | null;
  anonymousSessionId: string | null;
  metadata: string | null;
  userAgent: string | null;
  createdAt: number;
};

export async function insertFeedbackEvent(
  db: D1Database,
  record: FeedbackEventRecord,
): Promise<void> {
  await db.prepare(`
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
    record.id,
    record.kind,
    record.issue,
    record.page,
    record.query,
    record.courseId,
    record.subject,
    record.number,
    record.term,
    record.year,
    record.crn,
    record.instructorName,
    record.scoreField,
    record.expected,
    record.message,
    record.anonymousSessionId,
    record.metadata,
    record.userAgent,
    record.createdAt,
  ).run();
}
