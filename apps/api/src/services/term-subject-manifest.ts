import type { D1Database, VectorizeIndex } from '@cloudflare/workers-types';
import type { TermSyncResult } from './parallel-sync.js';
import { deleteCourseEmbeddings } from './embeddings.js';

const VECTOR_DELETE_BATCH_SIZE = 1_000;

export type TermSubjectManifestReconciliation = {
  applied: boolean;
  deletedCourseCount: number;
  reason?: 'incomplete_sync';
};

type ReconcileTermSubjectManifestOptions = {
  year: number;
  term: string;
  authoritativeSubjects: string[];
  syncResult: TermSyncResult;
  vectorize?: VectorizeIndex;
};

/**
 * Removes term rows for subjects that vanished from Course Explorer.
 *
 * The authoritative manifest is destructive evidence, so this function fails
 * closed unless the supplied result proves that every subject in that exact
 * manifest completed in one full-corpus run. When semantic indexing is
 * enabled, vectors are deleted before D1. A vector failure therefore leaves
 * the D1 rows (and their retryable IDs) intact.
 */
export async function reconcileTermSubjectManifest(
  db: D1Database,
  options: ReconcileTermSubjectManifestOptions,
): Promise<TermSubjectManifestReconciliation> {
  const subjects = normalizedManifest(options.authoritativeSubjects);
  if (!isCompleteManifestSync(options, subjects)) {
    return {
      applied: false,
      deletedCourseCount: 0,
      reason: 'incomplete_sync',
    };
  }

  const subjectsJson = JSON.stringify(subjects);
  const staleCourses = await db.prepare(`
    SELECT id
    FROM courses
    WHERE year = ?
      AND term = ?
      AND subject NOT IN (SELECT CAST(value AS TEXT) FROM json_each(?))
    ORDER BY id
  `).bind(options.year, options.term, subjectsJson).all<{ id: string }>();

  if (!staleCourses.success) {
    throw new Error(
      `Failed to load stale course IDs for ${options.year}-${options.term}`,
    );
  }

  const staleCourseIds = staleCourses.results.map(course => course.id);
  if (options.vectorize) {
    for (
      let index = 0;
      index < staleCourseIds.length;
      index += VECTOR_DELETE_BATCH_SIZE
    ) {
      await deleteCourseEmbeddings(
        options.vectorize,
        staleCourseIds.slice(index, index + VECTOR_DELETE_BATCH_SIZE),
      );
    }
  }

  const deletionResults = await db.batch([
    db.prepare(`
      DELETE FROM instructor_course_links
      WHERE term_id = ?
        AND subject NOT IN (
          SELECT CAST(value AS TEXT) FROM json_each(?)
        )
    `).bind(`${options.year}-${options.term}`, subjectsJson),
    db.prepare(`
      DELETE FROM subject_sync_state
      WHERE term_id = ?
        AND subject NOT IN (
          SELECT CAST(value AS TEXT) FROM json_each(?)
        )
    `).bind(`${options.year}-${options.term}`, subjectsJson),
    db.prepare(`
      DELETE FROM courses
      WHERE year = ?
        AND term = ?
        AND subject NOT IN (
          SELECT CAST(value AS TEXT) FROM json_each(?)
        )
    `).bind(options.year, options.term, subjectsJson),
  ]);
  if (deletionResults.some(result => !result.success)) {
    throw new Error(
      `Failed to reconcile subject manifest for ${options.year}-${options.term}`,
    );
  }

  return {
    applied: true,
    deletedCourseCount: staleCourseIds.length,
  };
}

function normalizedManifest(subjects: string[]): string[] {
  const normalized = subjects.map(subject => subject.trim().toUpperCase());
  if (
    normalized.length === 0
    || normalized.some(subject => !/^[A-Z]{2,4}$/.test(subject))
    || new Set(normalized).size !== normalized.length
  ) {
    throw new Error('Refusing invalid authoritative subject manifest');
  }
  return normalized;
}

function isCompleteManifestSync(
  options: ReconcileTermSubjectManifestOptions,
  subjects: string[],
): boolean {
  const result = options.syncResult;
  const pagination = result.pagination;
  if (
    result.year !== options.year
    || result.term !== options.term
    || result.termId !== `${options.year}-${options.term}`
    || !pagination
    || pagination.offset !== 0
    || pagination.hasMore
    || pagination.total !== subjects.length
    || pagination.limit !== subjects.length
    || result.subjectResults.length !== subjects.length
    || result.successfulSubjects !== subjects.length
    || result.failedSubjects !== 0
  ) {
    return false;
  }

  const completedSubjects = new Set<string>();
  for (const subject of result.subjectResults) {
    const normalizedSubject = subject.subject.trim().toUpperCase();
    if (
      !subject.success
      || subject.skipped
      || completedSubjects.has(normalizedSubject)
      || !subjects.includes(normalizedSubject)
    ) {
      return false;
    }
    completedSubjects.add(normalizedSubject);
  }

  return subjects.every(subject => completedSubjects.has(subject));
}
