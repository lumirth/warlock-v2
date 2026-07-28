import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Fetcher } from '@cloudflare/workers-types';
import { getTermsByStatus } from '../../db/term-state-repository.js';
import { getSubjectsForTerm, type TermSyncResult } from '../parallel-sync.js';
import { coordinateCourseSync } from '../sync-coordinator.js';
import { MAX_SYNC_SUBJECTS_PER_REQUEST } from '../sync-batch-contract.js';
import {
  recordCoordinatedTermSyncFailure,
  recordCoordinatedTermSyncResult,
} from '../course-sync-application.js';
import { reconcileTermSubjectManifest } from '../term-subject-manifest.js';

vi.mock('../../db/term-state-repository.js', () => ({
  getTermsByStatus: vi.fn(),
}));

vi.mock('../parallel-sync.js', () => ({
  getSubjectsForTerm: vi.fn(),
}));

vi.mock('../course-sync-application.js', () => ({
  recordCoordinatedTermSyncFailure: vi.fn(),
  recordCoordinatedTermSyncResult: vi.fn(),
}));

vi.mock('../term-subject-manifest.js', () => ({
  reconcileTermSubjectManifest: vi.fn(),
}));

describe('coordinateCourseSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(reconcileTermSubjectManifest).mockResolvedValue({
      applied: true,
      deletedCourseCount: 0,
    });
  });

  it('discovers active subjects and dispatches internal batches within the shared limit', async () => {
    vi.mocked(getTermsByStatus).mockImplementation(async (_db, status) => {
      if (status === 'registrable') {
        return [{
          term_id: '2026-spring',
          year: 2026,
          term: 'spring',
          status: 'registrable',
          last_checked: null,
          last_synced: null,
          subjects_count: null,
          courses_count: null,
          sections_count: null,
          sync_errors: null,
          created_at: 0,
          updated_at: 0,
        }];
      }
      return [];
    });
    vi.mocked(getSubjectsForTerm).mockResolvedValue(
      Array.from({ length: MAX_SYNC_SUBJECTS_PER_REQUEST + 1 }, (_, index) => `A${String.fromCharCode(65 + index)}`)
    );
    const fetch = vi.fn(async (_input: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        year: number;
        term: string;
        subjects: string[];
        forceRunningLocks: boolean;
      };
      expect(body.forceRunningLocks).toBe(false);
      return Response.json(syncResult(body.year, body.term, body.subjects));
    });

    const result = await coordinateCourseSync({
      DB: {} as never,
      SELF: { fetch } as unknown as Fetcher,
      CISAPI_BASE: 'https://courses.example.test',
      SYNC_CONCURRENCY: '4',
      INTERNAL_TOKEN: 'internal-token',
    }, {
      runId: 'cron-test',
      cron: '30 10,22 * * *',
      trigger: 'scheduled_course_sync',
    });

    expect(result).toMatchObject({
      termCount: 1,
      failedTermCount: 0,
      results: [{
        termId: '2026-spring',
        subjectCount: 21,
        batchCount: 2,
        failedBatchCount: 0,
        failedSubjectCount: 0,
        skippedSubjectCount: 0,
      }],
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    const firstBody = syncBatchBody(fetch.mock.calls[0]);
    const secondBody = syncBatchBody(fetch.mock.calls[1]);
    expect(firstBody).toMatchObject({
      year: 2026,
      term: 'spring',
      subjects: expect.arrayContaining(['AA']),
      totalSubjects: 21,
    });
    expect(firstBody.subjects).toHaveLength(MAX_SYNC_SUBJECTS_PER_REQUEST);
    expect(secondBody.subjects).toHaveLength(1);
    expect(recordCoordinatedTermSyncResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      totalSubjects: 21,
      result: expect.objectContaining({
        successfulSubjects: 21,
        failedSubjects: 0,
      }),
    }));
    expect(reconcileTermSubjectManifest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        year: 2026,
        term: 'spring',
        authoritativeSubjects: expect.arrayContaining(['AA']),
        syncResult: expect.objectContaining({
          successfulSubjects: 21,
          failedSubjects: 0,
        }),
      }),
    );
    expect(recordCoordinatedTermSyncFailure).not.toHaveBeenCalled();
  });

  it('treats a parsed subject failure as a failed term instead of trusting HTTP 200', async () => {
    const state = {
      term_id: '2026-fall',
      year: 2026,
      term: 'fall',
      status: 'active' as const,
      last_checked: null,
      last_synced: 100,
      subjects_count: 1,
      courses_count: 1,
      sections_count: 2,
      sync_errors: null,
      created_at: 0,
      updated_at: 0,
    };
    vi.mocked(getTermsByStatus).mockImplementation(async (_db, status) => status === 'active' ? [state] : []);
    vi.mocked(getSubjectsForTerm).mockResolvedValue(['CS']);
    const body = syncResult(2026, 'fall', ['CS']);
    body.subjectResults[0] = {
      subject: 'CS',
      success: false,
      coursesCount: 0,
      sectionsCount: 0,
      durationMs: 1,
      error: 'upstream failed',
    };
    body.totalCourses = 0;
    body.totalSections = 0;
    body.successfulSubjects = 0;
    body.failedSubjects = 1;

    const result = await coordinateCourseSync({
      DB: {} as never,
      SELF: { fetch: vi.fn(async () => Response.json(body)) } as unknown as Fetcher,
      CISAPI_BASE: 'https://courses.example.test',
      SYNC_CONCURRENCY: '4',
    }, {
      runId: 'cron-failure',
      cron: '30 10,22 * * *',
      trigger: 'scheduled_course_sync',
    });

    expect(result).toMatchObject({
      failedTermCount: 1,
      results: [{
        failedBatchCount: 1,
        failedSubjectCount: 1,
        success: false,
      }],
    });
    expect(recordCoordinatedTermSyncResult).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      result: expect.objectContaining({ failedSubjects: 1 }),
    }));
    expect(reconcileTermSubjectManifest).not.toHaveBeenCalled();
  });
});

function syncBatchBody(call: [string, RequestInit?]) {
  return JSON.parse(String(call[1]?.body)) as { subjects: string[] };
}

function syncResult(year: number, term: string, subjects: string[]): TermSyncResult {
  const subjectResults = subjects.map(subject => ({
    subject,
    success: true,
    coursesCount: 1,
    sectionsCount: 2,
    durationMs: 1,
  }));
  return {
    termId: `${year}-${term}`,
    year,
    term,
    subjectResults,
    totalCourses: subjectResults.length,
    totalSections: subjectResults.length * 2,
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
