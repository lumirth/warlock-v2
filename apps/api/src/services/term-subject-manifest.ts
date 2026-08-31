import type { D1Database, VectorizeIndex } from '@cloudflare/workers-types';
import { errorFields, logger } from '../observability/logger.js';
import { deleteCourseEmbeddings } from './embeddings.js';
import type { TermSyncResult } from './parallel-sync.js';

type Options = {
  year: number;
  term: string;
  authoritativeSubjects: string[];
  syncResult: TermSyncResult;
  vectorize?: VectorizeIndex;
};

export type TermSubjectManifestReconciliation = {
  applied: boolean;
  deletedCourseCount: number;
  reason?: 'incomplete_sync';
};

export async function reconcileTermSubjectManifest(
  db: D1Database,
  options: Options,
): Promise<TermSubjectManifestReconciliation> {
  const subjects = normalizeManifest(options.authoritativeSubjects);
  if (!completedExactly(options.syncResult, subjects, options.year, options.term)) {
    return { applied: false, deletedCourseCount: 0, reason: 'incomplete_sync' };
  }

  const manifest = JSON.stringify(subjects);
  const stale = await db.prepare(`
    SELECT id FROM courses WHERE year = ? AND term = ?
      AND subject NOT IN (SELECT CAST(value AS TEXT) FROM json_each(?))
    ORDER BY id
  `).bind(options.year, options.term, manifest).all<{ id: string }>();
  if (!stale.success) throw new Error('failed to read stale courses');
  const staleIds = stale.results.map(course => course.id);

  const termId = `${options.year}-${options.term}`;
  const deleted = await db.batch([
    db.prepare(`
      DELETE FROM instructor_course_links WHERE term_id = ?
        AND subject NOT IN (SELECT CAST(value AS TEXT) FROM json_each(?))
    `).bind(termId, manifest),
    db.prepare(`
      DELETE FROM subject_sync_state WHERE term_id = ?
        AND subject NOT IN (SELECT CAST(value AS TEXT) FROM json_each(?))
    `).bind(termId, manifest),
    db.prepare(`
      DELETE FROM courses WHERE year = ? AND term = ?
        AND subject NOT IN (SELECT CAST(value AS TEXT) FROM json_each(?))
    `).bind(options.year, options.term, manifest),
  ]);
  if (deleted.some(result => !result.success)) throw new Error(`failed to reconcile ${termId}`);
  if (options.vectorize) {
    for (let offset = 0; offset < staleIds.length; offset += 1_000) {
      const ids = staleIds.slice(offset, offset + 1_000);
      await deleteCourseEmbeddings(options.vectorize, ids).catch(error => {
        logger.warn('courseSync.embeddings.deleteFailed', {
          termId,
          courseCount: ids.length,
          ...errorFields(error),
        });
      });
    }
  }
  return { applied: true, deletedCourseCount: staleIds.length };
}

function normalizeManifest(input: string[]): string[] {
  const subjects = input.map(subject => subject.trim().toUpperCase());
  if (!subjects.length
    || subjects.some(subject => !/^[A-Z]{2,4}$/.test(subject))
    || new Set(subjects).size !== subjects.length) {
    throw new Error('refusing invalid authoritative subject manifest');
  }
  return subjects;
}

function completedExactly(
  result: TermSyncResult,
  subjects: string[],
  year: number,
  term: string,
): boolean {
  const completed = result.subjectResults
    .filter(subject => subject.success && !subject.skipped)
    .map(subject => subject.subject.trim().toUpperCase());
  return result.year === year
    && result.term === term
    && result.termId === `${year}-${term}`
    && result.subjectResults.length === subjects.length
    && result.failedSubjects === 0
    && result.successfulSubjects === subjects.length
    && completed.length === subjects.length
    && new Set(completed).size === subjects.length
    && completed.every(subject => subjects.includes(subject));
}
