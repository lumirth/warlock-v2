import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VectorizeIndex } from '@cloudflare/workers-types';
import type { TermSyncResult } from '../parallel-sync.js';
import { reconcileTermSubjectManifest } from '../term-subject-manifest.js';

const testEnv = env as { DB: D1Database };
const YEAR = 2028;
const TERM = 'winter';
const TERM_ID = `${YEAR}-${TERM}`;
const CURRENT_COURSE_ID = `NEW-100-${TERM_ID}`;
const STALE_COURSE_ID = `OLD-100-${TERM_ID}`;

describe('term subject manifest reconciliation', () => {
  beforeEach(async () => {
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        'DELETE FROM instructor_course_links WHERE term_id = ?',
      ).bind(TERM_ID),
      testEnv.DB.prepare(
        'DELETE FROM subject_sync_state WHERE term_id = ?',
      ).bind(TERM_ID),
      testEnv.DB.prepare(
        'DELETE FROM courses WHERE year = ? AND term = ?',
      ).bind(YEAR, TERM),
      testEnv.DB.prepare(`
        INSERT INTO subjects (id, name, last_synced)
        VALUES ('NEW', 'Current Studies', unixepoch())
        ON CONFLICT(id) DO UPDATE SET name = excluded.name
      `),
      testEnv.DB.prepare(`
        INSERT INTO subjects (id, name, last_synced)
        VALUES ('OLD', 'Removed Studies', unixepoch())
        ON CONFLICT(id) DO UPDATE SET name = excluded.name
      `),
      courseInsert(CURRENT_COURSE_ID, 'NEW'),
      courseInsert(STALE_COURSE_ID, 'OLD'),
      testEnv.DB.prepare(`
        INSERT INTO sections (
          id, crn, course_id, term_id, section_number, last_synced
        ) VALUES (?, '99001', ?, ?, 'A', unixepoch())
      `).bind(`${TERM_ID}-99001`, STALE_COURSE_ID, TERM_ID),
      testEnv.DB.prepare(`
        INSERT INTO instructor_course_links (
          term_id, subject, number, instructor_name
        ) VALUES (?, 'OLD', '100', 'Removed, Professor')
      `).bind(TERM_ID),
      subjectStateInsert('NEW'),
      subjectStateInsert('OLD'),
    ]);
  });

  it('never prunes from partial or failed sync evidence', async () => {
    const partial = completeResult(['NEW']);
    partial.pagination = {
      total: 2,
      offset: 0,
      limit: 1,
      hasMore: true,
    };

    await expect(reconcileTermSubjectManifest(testEnv.DB, {
      year: YEAR,
      term: TERM,
      authoritativeSubjects: ['NEW'],
      syncResult: partial,
    })).resolves.toEqual({
      applied: false,
      deletedCourseCount: 0,
      reason: 'incomplete_sync',
    });

    const failed = completeResult(['NEW']);
    failed.subjectResults[0] = {
      ...failed.subjectResults[0],
      success: false,
      error: 'upstream failure',
    };
    failed.successfulSubjects = 0;
    failed.failedSubjects = 1;

    await expect(reconcileTermSubjectManifest(testEnv.DB, {
      year: YEAR,
      term: TERM,
      authoritativeSubjects: ['NEW'],
      syncResult: failed,
    })).resolves.toMatchObject({ applied: false });

    await expect(courseIds()).resolves.toEqual([
      CURRENT_COURSE_ID,
      STALE_COURSE_ID,
    ]);
  });

  it('deletes missing subjects only after exact full-run evidence and retains retry IDs on vector failure', async () => {
    const deleteByIds = vi.fn()
      .mockRejectedValueOnce(new Error('vector unavailable'))
      .mockResolvedValue({ mutationId: 'delete-complete' });
    const vectorize = { deleteByIds } as unknown as VectorizeIndex;
    const options = {
      year: YEAR,
      term: TERM,
      authoritativeSubjects: ['NEW'],
      syncResult: completeResult(['NEW']),
      vectorize,
    };

    await expect(
      reconcileTermSubjectManifest(testEnv.DB, options),
    ).rejects.toThrow('vector unavailable');
    await expect(courseIds()).resolves.toEqual([
      CURRENT_COURSE_ID,
      STALE_COURSE_ID,
    ]);

    await expect(
      reconcileTermSubjectManifest(testEnv.DB, options),
    ).resolves.toEqual({
      applied: true,
      deletedCourseCount: 1,
    });
    expect(deleteByIds).toHaveBeenNthCalledWith(1, [STALE_COURSE_ID]);
    expect(deleteByIds).toHaveBeenNthCalledWith(2, [STALE_COURSE_ID]);
    await expect(courseIds()).resolves.toEqual([CURRENT_COURSE_ID]);

    const section = await testEnv.DB.prepare(
      'SELECT id FROM sections WHERE course_id = ?',
    ).bind(STALE_COURSE_ID).first();
    expect(section).toBeNull();

    const staleLink = await testEnv.DB.prepare(`
      SELECT subject
      FROM instructor_course_links
      WHERE term_id = ? AND subject = 'OLD'
    `).bind(TERM_ID).first();
    expect(staleLink).toBeNull();

    const staleState = await testEnv.DB.prepare(`
      SELECT subject
      FROM subject_sync_state
      WHERE term_id = ? AND subject = 'OLD'
    `).bind(TERM_ID).first();
    expect(staleState).toBeNull();
  });
});

function courseInsert(id: string, subject: string): D1PreparedStatement {
  return testEnv.DB.prepare(`
    INSERT INTO courses (
      id, subject, number, title, year, term, subject_id, last_synced
    ) VALUES (?, ?, '100', ?, ?, ?, ?, unixepoch())
  `).bind(
    id,
    subject,
    `${subject} course`,
    YEAR,
    TERM,
    subject,
  );
}

function subjectStateInsert(subject: string): D1PreparedStatement {
  return testEnv.DB.prepare(`
    INSERT INTO subject_sync_state (
      term_id, subject, last_sync, status, courses_synced, sections_synced
    ) VALUES (?, ?, unixepoch(), 'complete', 1, 1)
  `).bind(TERM_ID, subject);
}

async function courseIds(): Promise<string[]> {
  const result = await testEnv.DB.prepare(`
    SELECT id
    FROM courses
    WHERE year = ? AND term = ?
    ORDER BY id
  `).bind(YEAR, TERM).all<{ id: string }>();
  return result.results.map(course => course.id);
}

function completeResult(subjects: string[]): TermSyncResult {
  const subjectResults = subjects.map(subject => ({
    subject,
    success: true,
    coursesCount: 1,
    sectionsCount: 1,
    durationMs: 1,
  }));
  return {
    termId: TERM_ID,
    year: YEAR,
    term: TERM,
    subjectResults,
    totalCourses: subjectResults.length,
    totalSections: subjectResults.length,
    successfulSubjects: subjectResults.length,
    failedSubjects: 0,
    durationMs: subjectResults.length,
    rateLimitHits: 0,
    pagination: {
      total: subjects.length,
      offset: 0,
      limit: subjects.length,
      hasMore: false,
    },
  };
}
