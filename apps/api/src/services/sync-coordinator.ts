import type { D1Database, Fetcher, VectorizeIndex } from '@cloudflare/workers-types';
import type { TermState } from '../db/types.js';
import { internalAuthHeaders } from '../middleware/auth.js';
import { errorFields, logger } from '../observability/logger.js';
import {
  getSubjectsForTerm,
  summarizeTermSync,
  type SubjectSyncResult,
  type TermSyncResult,
} from './parallel-sync.js';
import { reconcileTermSubjectManifest } from './term-subject-manifest.js';
import { syncConcurrency } from './sync-operations.js';

const SUBJECTS_PER_REQUEST = 20;

type Env = {
  DB: D1Database;
  SELF: Fetcher;
  CISAPI_BASE: string;
  SYNC_CONCURRENCY: string;
  VECTORIZE: VectorizeIndex;
  INTERNAL_TOKEN?: string;
};

export async function coordinateCourseSync(env: Env, options: { runId: string }) {
  const terms = await env.DB.prepare(`
    SELECT * FROM term_state WHERE status IN ('registrable', 'active')
    ORDER BY CASE status WHEN 'registrable' THEN 0 ELSE 1 END, year DESC
  `).all<TermState>();
  const results = [];
  for (const term of terms.results) results.push(await syncTerm(env, term, options.runId));
  return {
    termCount: results.length,
    results,
    failedTermCount: results.filter(result => !result.success).length,
  };
}

async function syncTerm(env: Env, term: TermState, runId: string) {
  try {
    return await syncTermOrThrow(env, term, runId);
  } catch (error) {
    logger.error('courseSync.term.failed', { runId, termId: term.term_id, ...errorFields(error) });
    await recordFailure(env.DB, term.term_id, error);
    return outcome(term.term_id, false);
  }
}

async function syncTermOrThrow(env: Env, term: TermState, runId: string) {
  const subjects = await getSubjectsForTerm({
    cisapiBase: env.CISAPI_BASE,
    concurrency: syncConcurrency(env.SYNC_CONCURRENCY),
  }, term.year, term.term);
  rejectImplausibleShrink(term, subjects.length);

  const batches = chunk(subjects, SUBJECTS_PER_REQUEST);
  const { results, failedBatchCount } = await runBatches(env, term, batches, runId);
  const aggregate = summarizeTermSync(
    term.year,
    term.term,
    results.flatMap(result => result.subjectResults),
    results.reduce((sum, result) => sum + result.durationMs, 0),
  );
  const skipped = aggregate.subjectResults.filter(result => result.skipped).length;
  const complete = failedBatchCount === 0
    && aggregate.failedSubjects === 0
    && skipped === 0
    && aggregate.subjectResults.length === subjects.length;

  let deletedCourseCount = 0;
  if (complete) {
    const reconciliation = await reconcileTermSubjectManifest(env.DB, {
      year: term.year,
      term: term.term,
      authoritativeSubjects: subjects,
      syncResult: aggregate,
      vectorize: env.VECTORIZE,
    });
    if (!reconciliation.applied) throw new Error('refused incomplete term publication');
    deletedCourseCount = reconciliation.deletedCourseCount;
  }

  await recordResult(env.DB, term.term_id, aggregate, subjects.length, complete);
  return outcome(term.term_id, complete, {
    subjectCount: subjects.length,
    batchCount: batches.length,
    failedBatchCount,
    failedSubjectCount: aggregate.failedSubjects,
    skippedSubjectCount: skipped,
    deletedCourseCount,
  });
}

async function runBatches(
  env: Env,
  term: TermState,
  batches: string[][],
  runId: string,
): Promise<{ results: TermSyncResult[]; failedBatchCount: number }> {
  const results: TermSyncResult[] = [];
  let failedBatchCount = 0;
  for (const subjects of batches) {
    try {
      results.push(await dispatchBatch(env, term, subjects));
    } catch (error) {
      failedBatchCount += 1;
      logger.error('courseSync.batch.failed', { runId, termId: term.term_id, ...errorFields(error) });
      const failed: SubjectSyncResult[] = subjects.map(subject => ({
        subject,
        success: false,
        coursesCount: 0,
        sectionsCount: 0,
        durationMs: 0,
        error: error instanceof Error ? error.message : String(error),
      }));
      results.push(summarizeTermSync(term.year, term.term, failed, 0));
    }
  }
  return { results, failedBatchCount };
}

async function dispatchBatch(env: Env, term: TermState, subjects: string[]): Promise<TermSyncResult> {
  const response = await env.SELF.fetch('http://internal/internal/sync-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...internalAuthHeaders(env.INTERNAL_TOKEN) },
    body: JSON.stringify({ year: term.year, term: term.term, subjects }),
  });
  if (!response.ok) throw new Error(`sync batch returned HTTP ${response.status}`);
  return response.json<TermSyncResult>();
}

async function recordResult(
  db: D1Database,
  termId: string,
  result: TermSyncResult,
  subjectCount: number,
  complete: boolean,
): Promise<void> {
  const errors = result.subjectResults
    .filter(subject => !subject.success || subject.skipped)
    .map(subject => ({ subject: subject.subject, error: subject.error ?? 'not refreshed' }));
  await db.prepare(`
    UPDATE term_state SET
      last_synced = CASE WHEN ? THEN unixepoch() ELSE last_synced END,
      subjects_count = CASE WHEN ? THEN ? ELSE subjects_count END,
      courses_count = CASE WHEN ? THEN ? ELSE courses_count END,
      sections_count = CASE WHEN ? THEN ? ELSE sections_count END,
      sync_errors = ?
    WHERE term_id = ?
  `).bind(
    complete, complete, subjectCount, complete, result.totalCourses,
    complete, result.totalSections, complete ? null : JSON.stringify(errors), termId,
  ).run();
}

async function recordFailure(db: D1Database, termId: string, error: unknown): Promise<void> {
  await db.prepare(`
    UPDATE term_state SET sync_errors = ? WHERE term_id = ?
  `).bind(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), termId).run();
}

function outcome(termId: string, success: boolean, counts = {}) {
  return {
    termId,
    subjectCount: 0,
    batchCount: 0,
    failedBatchCount: 0,
    failedSubjectCount: 0,
    skippedSubjectCount: 0,
    deletedCourseCount: 0,
    ...counts,
    success,
  };
}

function rejectImplausibleShrink(term: TermState, nextCount: number): void {
  if (term.subjects_count && term.subjects_count >= 20 && nextCount * 4 < term.subjects_count * 3) {
    throw new Error(`refusing subject shrink from ${term.subjects_count} to ${nextCount}`);
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size));
}
