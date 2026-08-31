import type { D1Database } from '@cloudflare/workers-types';
import { parseSubjectCascadeXml, parseSubjectsXml, type ParsedSubjectCascade } from '../cisapi/parser.js';
import { browserFetch } from '../http/browser-fetch.js';
import { fromSubjectCascade } from '../transforms/course.js';
import { writeSubjectSnapshotToD1, type SubjectSnapshotPublicationFence } from './course-snapshot-writer.js';

export const SUBJECT_LEASE_TTL_SECONDS = 5 * 60;

export type ParallelSyncConfig = { cisapiBase: string; concurrency: number };
export type SubjectSyncResult = {
  subject: string;
  success: boolean;
  coursesCount: number;
  sectionsCount: number;
  durationMs: number;
  error?: string;
  skipped?: boolean;
};
export type TermSyncResult = {
  termId: string;
  year: number;
  term: string;
  subjectResults: SubjectSyncResult[];
  totalCourses: number;
  totalSections: number;
  successfulSubjects: number;
  failedSubjects: number;
  durationMs: number;
  rateLimitHits: number;
};

export function summarizeTermSync(
  year: number,
  term: string,
  subjectResults: SubjectSyncResult[],
  durationMs: number,
): TermSyncResult {
  return {
    termId: `${year}-${term}`,
    year,
    term,
    subjectResults,
    totalCourses: subjectResults.reduce((sum, result) => sum + result.coursesCount, 0),
    totalSections: subjectResults.reduce((sum, result) => sum + result.sectionsCount, 0),
    successfulSubjects: subjectResults.filter(result => result.success).length,
    failedSubjects: subjectResults.filter(result => !result.success).length,
    durationMs,
    rateLimitHits: subjectResults.filter(result => /HTTP (429|503)/.test(result.error ?? '')).length,
  };
}

export async function getSubjectsForTerm(
  config: ParallelSyncConfig,
  year: number,
  term: string,
): Promise<string[]> {
  const response = await browserFetch(
    `${config.cisapiBase}/schedule/${year}/${term}.xml`,
    { timeoutMs: 30_000 },
  );
  if (!response.ok) throw new Error(`subject list returned HTTP ${response.status}`);
  const subjects = [...new Set(
    parseSubjectsXml(await response.text())
      .map(subject => subject.id.trim().toUpperCase())
      .filter(Boolean),
  )];
  if (subjects.length === 0) throw new Error(`refusing empty subject list for ${year}-${term}`);
  return subjects;
}

export async function syncSubjects(
  db: D1Database,
  config: ParallelSyncConfig,
  year: number,
  term: string,
  subjects: string[],
): Promise<TermSyncResult> {
  const started = Date.now();
  const results: SubjectSyncResult[] = [];

  for (let offset = 0; offset < subjects.length; offset += config.concurrency) {
    results.push(...await Promise.all(
      subjects.slice(offset, offset + config.concurrency)
        .map(subject => syncSubject(db, config, year, term, subject)),
    ));
  }

  return summarizeTermSync(year, term, results, Date.now() - started);
}

async function syncSubject(
  db: D1Database,
  config: ParallelSyncConfig,
  year: number,
  term: string,
  subject: string,
): Promise<SubjectSyncResult> {
  const started = Date.now();
  const lease = await acquireLease(db, `${year}-${term}`, subject);
  if (!lease) {
    return { subject, success: true, skipped: true, coursesCount: 0, sectionsCount: 0, durationMs: Date.now() - started };
  }

  try {
    const parsed = await fetchSubject(config.cisapiBase, year, term, subject);
    const snapshot = fromSubjectCascade(parsed, year, term);
    await renewLease(db, lease);
    const counts = await writeSubjectSnapshotToD1(db, snapshot, { publicationFence: lease });
    await renewLease(db, lease);
    if (!await finishLease(db, lease, 'complete', counts)) {
      throw new Error('subject lease changed before completion');
    }
    return { subject, success: true, ...counts, durationMs: Date.now() - started };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishLease(db, lease, 'failed', { coursesCount: 0, sectionsCount: 0 }, message);
    return {
      subject,
      success: false,
      coursesCount: 0,
      sectionsCount: 0,
      durationMs: Date.now() - started,
      error: message,
    };
  }
}

async function fetchSubject(
  base: string,
  year: number,
  term: string,
  subject: string,
): Promise<ParsedSubjectCascade> {
  const response = await browserFetch(
    `${base}/schedule/${year}/${term}/${subject}.xml?mode=cascade`,
    { timeoutMs: 60_000 },
  );
  if (!response.ok || !response.body) throw new Error(`${subject} returned HTTP ${response.status}`);
  return parseSubjectCascadeXml(response.body);
}

async function acquireLease(
  db: D1Database,
  termId: string,
  subject: string,
): Promise<SubjectSnapshotPublicationFence | null> {
  const ownerToken = crypto.randomUUID();
  const result = await db.prepare(`
    INSERT INTO subject_sync_state
      (term_id, subject, last_sync, status, courses_synced, sections_synced, error, owner_token)
    VALUES (?, ?, unixepoch(), 'running', 0, 0, NULL, ?)
    ON CONFLICT(term_id, subject) DO UPDATE SET
      last_sync = excluded.last_sync, status = 'running', courses_synced = 0,
      sections_synced = 0, error = NULL, owner_token = excluded.owner_token
    WHERE subject_sync_state.status != 'running'
       OR subject_sync_state.last_sync <= unixepoch() - ?
  `).bind(termId, subject, ownerToken, SUBJECT_LEASE_TTL_SECONDS).run();
  return (result.meta?.changes ?? 0) === 1 ? { termId, subject, ownerToken } : null;
}

async function renewLease(db: D1Database, lease: SubjectSnapshotPublicationFence): Promise<void> {
  const result = await db.prepare(`
    UPDATE subject_sync_state SET last_sync = unixepoch()
    WHERE term_id = ? AND subject = ? AND owner_token = ? AND status = 'running'
  `).bind(lease.termId, lease.subject, lease.ownerToken).run();
  if ((result.meta?.changes ?? 0) !== 1) throw new Error('subject lease changed before publication');
}

async function finishLease(
  db: D1Database,
  lease: SubjectSnapshotPublicationFence,
  status: 'complete' | 'failed',
  counts: { coursesCount: number; sectionsCount: number },
  error?: string,
): Promise<boolean> {
  const result = await db.prepare(`
    UPDATE subject_sync_state
    SET last_sync = unixepoch(), status = ?, courses_synced = ?, sections_synced = ?,
      error = ?, owner_token = NULL
    WHERE term_id = ? AND subject = ? AND owner_token = ? AND status = 'running'
  `).bind(
    status,
    counts.coursesCount,
    counts.sectionsCount,
    error ?? null,
    lease.termId,
    lease.subject,
    lease.ownerToken,
  ).run();
  return (result.meta?.changes ?? 0) === 1;
}
