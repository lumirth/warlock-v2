import type { D1Database, VectorizeIndex, Ai } from '@cloudflare/workers-types';
import { parseSubjectsXml, parseSubjectCascadeXml, type ParsedSubjectCascade } from '../cisapi/parser.js';
import {
  writeSubjectSnapshotToD1,
  type SubjectSnapshotPublicationFence,
} from './course-snapshot-writer.js';
import {
  courseSnapshotToEmbeddingData,
  deleteCourseEmbeddings,
  upsertCourseEmbeddingsInBatches,
} from './embeddings.js';
import { getUpstreamBackoff } from './upstream-backoff.js';
import { browserFetch } from '../http/browser-fetch.js';
import { fromSubjectCascade } from '../transforms/course.js';
import type { SyncRunStatus } from '../db/types.js';
import { assertPublishableSubjectSnapshot } from './validation.js';

const SUBJECT_SYNC_LOCK_TTL_SECONDS = 30 * 60;
const SUBJECT_CASCADE_TIMEOUT_MS = 60_000;
const SUBJECT_LIST_TIMEOUT_MS = 30_000;

export interface ParallelSyncConfig {
  cisapiBase: string;
  concurrency: number;
  offset?: number;
  limit?: number;
}

type SubjectLockMode = 'respect-running' | 'force';

interface SyncSubjectsOptions {
  lockMode?: SubjectLockMode;
}

type SubjectSyncLease = SubjectSnapshotPublicationFence;

export interface SubjectSyncResult {
  subject: string;
  success: boolean;
  coursesCount: number;
  sectionsCount: number;
  error?: string;
  skipped?: boolean;
  durationMs: number;
}

export interface TermSyncResult {
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
  staleDataWarning?: string;
  pagination?: {
    total: number;
    offset: number;
    limit: number;
    hasMore: boolean;
  };
}

async function fetchSubjectCascade(
  config: ParallelSyncConfig,
  year: number,
  term: string,
  subject: string
): Promise<ParsedSubjectCascade | null> {
  const upstreamBackoff = getUpstreamBackoff();
  await upstreamBackoff.waitIfNeeded();

  const url = `${config.cisapiBase}/schedule/${year}/${term}/${subject}.xml?mode=cascade`;

  const response = await browserFetch(url, { timeoutMs: SUBJECT_CASCADE_TIMEOUT_MS });

  if (!response.ok) {
    if (upstreamBackoff.isRateLimited(response.status)) {
      const backoffMs = upstreamBackoff.recordFailure(
        `${subject}: HTTP ${response.status}`,
        response.status
      );
      throw new Error(`Rate limited on ${subject}, backing off ${backoffMs}ms`);
    }
    throw new Error(`HTTP ${response.status} for ${subject}`);
  }

  upstreamBackoff.recordSuccess();

  // Use streaming parser to avoid loading entire XML into memory
  if (!response.body) {
     // Fallback if no body (shouldn't happen with fetch)
     const xml = await response.text();
     if (xml.includes('<!DOCTYPE html>') || xml.includes('<html')) {
       throw new Error(`HTML response for ${subject} (likely 404)`);
     }
     // Create a stream from the text
     const stream = new ReadableStream({
       start(controller) {
         controller.enqueue(new TextEncoder().encode(xml));
         controller.close();
       }
     });
     return parseSubjectCascadeXml(stream);
  }

  return parseSubjectCascadeXml(response.body);
}

async function saveSubjectData(
  db: D1Database,
  parsed: ParsedSubjectCascade,
  expectedSubject: string,
  year: number,
  term: string,
  lease: SubjectSyncLease,
  vectorize?: VectorizeIndex,
  ai?: Ai
): Promise<{ coursesCount: number; sectionsCount: number }> {
  const snapshot = fromSubjectCascade(parsed, year, term);
  assertPublishableSubjectSnapshot(snapshot, expectedSubject);
  let embeddingData: ReturnType<typeof courseSnapshotToEmbeddingData>[] | undefined;
  let staleCourseIds: string[] = [];

  if (vectorize && ai) {
    const existingCourseIds = await loadSubjectCourseIds(db, parsed.subjectId, year, term);
    const currentCourseIds = new Set(snapshot.courses.map(course => course.course.id));
    staleCourseIds = existingCourseIds.filter(courseId => !currentCourseIds.has(courseId));
    embeddingData = snapshot.courses.map(courseSnapshotToEmbeddingData);
  }

  await renewSubjectSyncLease(db, lease);
  const { coursesCount, sectionsCount } = await writeSubjectSnapshotToD1(
    db,
    snapshot,
    { publicationFence: lease }
  );

  if (vectorize && ai && embeddingData) {
    await renewSubjectSyncLease(db, lease);
    await upsertCourseEmbeddingsInBatches(vectorize, ai, embeddingData);
    await renewSubjectSyncLease(db, lease);
    await deleteCourseEmbeddings(vectorize, staleCourseIds);
  }

  return { coursesCount, sectionsCount };
}

async function loadSubjectCourseIds(
  db: D1Database,
  subject: string,
  year: number,
  term: string
): Promise<string[]> {
  const result = await db.prepare(`
    SELECT id FROM courses
    WHERE subject = ? AND year = ? AND term = ?
  `).bind(subject, year, term).all<{ id: string }>();

  if (!result.success) {
    throw new Error(`Failed to load existing course IDs for ${subject} ${year} ${term}`);
  }
  return result.results.map(row => row.id);
}

export async function getSubjectsForTerm(
  config: ParallelSyncConfig,
  year: number,
  term: string
): Promise<string[]> {
  const upstreamBackoff = getUpstreamBackoff();
  await upstreamBackoff.waitIfNeeded();

  const url = `${config.cisapiBase}/schedule/${year}/${term}.xml`;
  const response = await browserFetch(url, { timeoutMs: SUBJECT_LIST_TIMEOUT_MS });

  if (!response.ok) {
    throw new Error(`Failed to get subjects: HTTP ${response.status}`);
  }

  upstreamBackoff.recordSuccess();

  const xml = await response.text();
  const subjects = [
    ...new Set(
      parseSubjectsXml(xml)
        .map(subject => subject.id.trim().toUpperCase())
        .filter(Boolean)
    ),
  ];
  if (subjects.length === 0) {
    throw new Error(`Refusing empty subject list for ${year}-${term}`);
  }
  return subjects;
}

export async function syncSubjects(
  db: D1Database,
  config: ParallelSyncConfig,
  year: number,
  term: string,
  subjects: string[],
  vectorize?: VectorizeIndex,
  ai?: Ai,
  options: SyncSubjectsOptions = {}
): Promise<TermSyncResult> {
  const startTime = Date.now();
  const termId = `${year}-${term}`;
  const lockMode = options.lockMode ?? 'respect-running';

  const results: SubjectSyncResult[] = [];
  let rateLimitHits = 0;

  for (let i = 0; i < subjects.length; i += config.concurrency) {
    const batch = subjects.slice(i, i + config.concurrency);

    const batchPromises = batch.map(async (subject): Promise<SubjectSyncResult> => {
      const subjectStart = Date.now();
      const ownerToken = await acquireSubjectSyncLock(db, termId, subject, lockMode);
      if (!ownerToken) {
        return {
          subject,
          success: true,
          skipped: true,
          coursesCount: 0,
          sectionsCount: 0,
          durationMs: Date.now() - subjectStart
        };
      }
      const lease: SubjectSyncLease = { termId, subject, ownerToken };

      try {
        const parsed = await fetchSubjectCascade(config, year, term, subject);

        if (!parsed) {
          throw new Error('Failed to parse response');
        }

        const { coursesCount, sectionsCount } = await saveSubjectData(
          db, parsed, subject, year, term, lease, vectorize, ai
        );
        const completed = await finishSubjectSync(
          db,
          lease,
          'complete',
          coursesCount,
          sectionsCount
        );
        if (!completed) {
          throw new Error(
            'Subject sync lease ownership changed; refusing stale completion checkpoint'
          );
        }

        return {
          subject,
          success: true,
          coursesCount,
          sectionsCount,
          durationMs: Date.now() - subjectStart
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        await finishSubjectSync(db, lease, 'failed', 0, 0, errorMsg);
        if (errorMsg.includes('Rate limited')) {
          rateLimitHits++;
        }

        return {
          subject,
          success: false,
          coursesCount: 0,
          sectionsCount: 0,
          error: errorMsg,
          durationMs: Date.now() - subjectStart
        };
      }
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }

  const upstreamBackoff = getUpstreamBackoff();
  const staleWarning = upstreamBackoff.getStaleDataWarning();

  return {
    termId,
    year,
    term,
    subjectResults: results,
    totalCourses: results.reduce((sum, r) => sum + r.coursesCount, 0),
    totalSections: results.reduce((sum, r) => sum + r.sectionsCount, 0),
    successfulSubjects: results.filter(r => r.success).length,
    failedSubjects: results.filter(r => !r.success).length,
    durationMs: Date.now() - startTime,
    rateLimitHits,
    staleDataWarning: staleWarning ?? undefined,
    pagination: {
      total: subjects.length,
      offset: 0,
      limit: subjects.length,
      hasMore: false
    }
  };
}

async function acquireSubjectSyncLock(
  db: D1Database,
  termId: string,
  subject: string,
  lockMode: SubjectLockMode = 'respect-running'
): Promise<string | null> {
  const ownerToken = `subject:${crypto.randomUUID()}`;
  const result = await db.prepare(`
    INSERT INTO subject_sync_state (
      term_id, subject, last_sync, status, courses_synced, sections_synced, error,
      owner_token
    )
    VALUES (?, ?, unixepoch(), 'running', 0, 0, NULL, ?)
    ON CONFLICT(term_id, subject) DO UPDATE SET
      last_sync = excluded.last_sync,
      status = excluded.status,
      courses_synced = excluded.courses_synced,
      sections_synced = excluded.sections_synced,
      error = excluded.error,
      owner_token = excluded.owner_token
    WHERE ? = 1
       OR subject_sync_state.status != 'running'
       OR subject_sync_state.last_sync IS NULL
       OR subject_sync_state.last_sync <= unixepoch() - ?
  `).bind(
    termId,
    subject,
    ownerToken,
    lockMode === 'force' ? 1 : 0,
    SUBJECT_SYNC_LOCK_TTL_SECONDS
  ).run();

  return (result.meta?.changes ?? 0) > 0 ? ownerToken : null;
}

async function renewSubjectSyncLease(
  db: D1Database,
  lease: SubjectSyncLease
): Promise<void> {
  const result = await db.prepare(`
    UPDATE subject_sync_state
    SET last_sync = unixepoch()
    WHERE term_id = ?
      AND subject = ?
      AND owner_token = ?
      AND status = 'running'
  `).bind(lease.termId, lease.subject, lease.ownerToken).run();
  if ((result.meta?.changes ?? 0) !== 1) {
    throw new Error(
      'Subject sync lease ownership changed; refusing stale data publication'
    );
  }
}

async function finishSubjectSync(
  db: D1Database,
  lease: SubjectSyncLease,
  status: SyncRunStatus,
  coursesCount: number,
  sectionsCount: number,
  error?: string
): Promise<boolean> {
  const result = await db.prepare(`
    UPDATE subject_sync_state
    SET last_sync = unixepoch(),
        status = ?,
        courses_synced = ?,
        sections_synced = ?,
        error = ?,
        owner_token = NULL
    WHERE term_id = ?
      AND subject = ?
      AND owner_token = ?
      AND status = 'running'
  `).bind(
    status,
    coursesCount,
    sectionsCount,
    error ?? null,
    lease.termId,
    lease.subject,
    lease.ownerToken
  ).run();
  return (result.meta?.changes ?? 0) === 1;
}

export async function syncTerm(
  db: D1Database,
  config: ParallelSyncConfig,
  year: number,
  term: string,
  vectorize?: VectorizeIndex,
  ai?: Ai,
  options: SyncSubjectsOptions = {}
): Promise<TermSyncResult> {
  const allSubjects = await getSubjectsForTerm(config, year, term);
  const totalSubjects = allSubjects.length;

  // Apply pagination - default to a small operator-safe page for Worker limits.
  const offset = config.offset ?? 0;
  const limit = config.limit ?? 5;
  const subjects = allSubjects.slice(offset, offset + limit);
  const hasMore = offset + limit < totalSubjects;

  const result = await syncSubjects(db, config, year, term, subjects, vectorize, ai, options);

  // Update pagination info since syncSubjects doesn't know about the global list
  if (result.pagination) {
    result.pagination.total = totalSubjects;
    result.pagination.offset = offset;
    result.pagination.limit = limit;
    result.pagination.hasMore = hasMore;
  }

  return result;
}
