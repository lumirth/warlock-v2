import type { D1Database } from '@cloudflare/workers-types';

type Options = {
  year: number;
  term: string;
  authoritativeSubjects: string[];
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
  const manifest = JSON.stringify(subjects);
  const incomplete = await db.prepare(`
    SELECT 1 AS incomplete FROM json_each(?) AS manifest
    LEFT JOIN subject_sync_state AS state
      ON state.term_id = ? AND state.subject = CAST(manifest.value AS TEXT)
    WHERE state.status IS NOT 'complete' LIMIT 1
  `).bind(manifest, `${options.year}-${options.term}`).first();
  if (incomplete) {
    return { applied: false, deletedCourseCount: 0, reason: 'incomplete_sync' };
  }

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
