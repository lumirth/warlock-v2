import type { D1Database, VectorizeIndex, Ai } from '@cloudflare/workers-types';
import { parseSubjectsXml, parseSubjectCascadeXml, type ParsedSubjectCascade } from '../cisapi/parser.js';
import { writeSubjectSnapshotToD1 } from './course-snapshot-writer.js';
import { courseSnapshotToEmbeddingData, upsertCourseEmbedding } from './embeddings.js';
import { getUpstreamBackoff } from './upstream-backoff.js';
import { browserFetch } from '../http/browser-fetch.js';
import { fromSubjectCascade } from '../transforms/course.js';
import { errorFields, logger } from '../observability/logger.js';

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

interface SubjectSyncResult {
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
  year: number,
  term: string,
  vectorize?: VectorizeIndex,
  ai?: Ai
): Promise<{ coursesCount: number; sectionsCount: number }> {
  const snapshot = fromSubjectCascade(parsed, year, term);
  const { coursesCount, sectionsCount } =
    await writeSubjectSnapshotToD1(db, snapshot);

  // Process Embeddings
  if (vectorize && ai) {
    // Process embeddings in parallel chunks to speed up
    const EMBEDDING_CONCURRENCY = 5;
    for (let i = 0; i < snapshot.courses.length; i += EMBEDDING_CONCURRENCY) {
      const chunk = snapshot.courses.slice(i, i + EMBEDDING_CONCURRENCY);
      await Promise.all(chunk.map(async (courseSnapshot) => {
        try {
          await upsertCourseEmbedding(
            vectorize,
            ai,
            courseSnapshotToEmbeddingData(courseSnapshot)
          );
        } catch (e) {
          logger.error('parallelSync.embedding.failed', { courseId: courseSnapshot.course.id, ...errorFields(e) });
        }
      }));
    }
  }

  return { coursesCount, sectionsCount };
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
  return parseSubjectsXml(xml).map(subject => subject.id);
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
      const lockAcquired = await acquireSubjectSyncLock(db, termId, subject, lockMode);
      if (!lockAcquired) {
        return {
          subject,
          success: true,
          skipped: true,
          coursesCount: 0,
          sectionsCount: 0,
          durationMs: Date.now() - subjectStart
        };
      }

      try {
        const parsed = await fetchSubjectCascade(config, year, term, subject);

        if (!parsed) {
          await updateSubjectSyncState(db, termId, subject, 'failed', 0, 0, 'Failed to parse response');
          return {
            subject,
            success: false,
            coursesCount: 0,
            sectionsCount: 0,
            error: 'Failed to parse response',
            durationMs: Date.now() - subjectStart
          };
        }

        const { coursesCount, sectionsCount } = await saveSubjectData(
          db, parsed, year, term, vectorize, ai
        );
        await updateSubjectSyncState(db, termId, subject, 'complete', coursesCount, sectionsCount);

        return {
          subject,
          success: true,
          coursesCount,
          sectionsCount,
          durationMs: Date.now() - subjectStart
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        await updateSubjectSyncState(db, termId, subject, 'failed', 0, 0, errorMsg);
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
): Promise<boolean> {
  const id = subjectSyncStateId(termId, subject);
  const existing = await db.prepare(`
    SELECT last_sync, last_status
    FROM sync_state
    WHERE id = ?
  `).bind(id).first<{ last_sync: number | null; last_status: string | null }>();

  const now = Math.floor(Date.now() / 1000);
  if (
    lockMode !== 'force'
    && existing?.last_status === 'running'
    && existing.last_sync
    && now - existing.last_sync < SUBJECT_SYNC_LOCK_TTL_SECONDS
  ) {
    return false;
  }

  await db.prepare(`
    INSERT INTO sync_state (id, last_sync, last_status, items_synced, cursor, etag)
    VALUES (?, unixepoch(), 'running', 0, 0, NULL)
    ON CONFLICT(id) DO UPDATE SET
      last_sync = excluded.last_sync,
      last_status = excluded.last_status,
      items_synced = excluded.items_synced,
      cursor = excluded.cursor,
      etag = excluded.etag
  `).bind(id).run();

  return true;
}

async function updateSubjectSyncState(
  db: D1Database,
  termId: string,
  subject: string,
  status: string,
  coursesCount: number,
  sectionsCount: number,
  error?: string
): Promise<void> {
  await db.prepare(`
    INSERT INTO sync_state (id, last_sync, last_status, items_synced, cursor, etag)
    VALUES (?, unixepoch(), ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      last_sync = excluded.last_sync,
      last_status = excluded.last_status,
      items_synced = excluded.items_synced,
      cursor = excluded.cursor,
      etag = excluded.etag
  `).bind(subjectSyncStateId(termId, subject), status, coursesCount, sectionsCount, error ?? null).run();
}

function subjectSyncStateId(termId: string, subject: string): string {
  return `course-sync:${termId}:${subject}`;
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
