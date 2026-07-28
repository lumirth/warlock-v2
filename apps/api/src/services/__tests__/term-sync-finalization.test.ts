import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import type { SubjectSyncState, TermState } from '../../db/types.js';
import { getTermState } from '../../db/term-state-repository.js';
import {
  recordCoordinatedTermSyncResult,
} from '../course-sync-application.js';
import { getSubjectsForTerm } from '../parallel-sync.js';
import { finalizeTermSync } from '../term-sync-finalization.js';
import { reconcileTermSubjectManifest } from '../term-subject-manifest.js';

vi.mock('../../db/term-state-repository.js', () => ({
  getTermState: vi.fn(),
}));

vi.mock('../course-sync-application.js', () => ({
  recordCoordinatedTermSyncResult: vi.fn(),
}));

vi.mock('../parallel-sync.js', () => ({
  getSubjectsForTerm: vi.fn(),
}));

vi.mock('../term-subject-manifest.js', () => ({
  reconcileTermSubjectManifest: vi.fn(),
}));

const TERM_ID = '2026-fall';
const CS_MANIFEST_SHA256 =
  '3bd84e6d5f774ad4e39d82e66bb084144aa732e7041a0c19542322762fcdab68';
const CS_MATH_MANIFEST_SHA256 =
  '1da62d26bb31fbc8104f644e5c7bfa0a93869ae99b69889a2722a43e8a522f30';

describe('term sync finalization', () => {
  beforeEach(() => {
    vi.mocked(getTermState).mockReset();
    vi.mocked(getSubjectsForTerm).mockReset();
    vi.mocked(reconcileTermSubjectManifest).mockReset();
    vi.mocked(recordCoordinatedTermSyncResult).mockReset();
  });

  it('proves exact durable coverage, reconciles removals, and publishes freshness', async () => {
    const currentTerm = termState();
    vi.mocked(getTermState)
      .mockResolvedValueOnce(currentTerm)
      .mockResolvedValueOnce(termState({
        last_synced: 1_800_000_000,
        subjects_count: 1,
        courses_count: 10,
        sections_count: 20,
      }));
    vi.mocked(getSubjectsForTerm).mockResolvedValue(['CS']);
    vi.mocked(reconcileTermSubjectManifest).mockResolvedValue({
      applied: true,
      deletedCourseCount: 2,
    });
    const db = subjectStateDb([
      [subjectState('CS'), subjectState('OLD', { status: 'failed' })],
      [subjectState('CS')],
    ]);

    await expect(finalizeTermSync(env(db), {
      year: 2026,
      term: 'fall',
      minimumLastSync: 1_700_000_000,
      expectedManifestSha256: CS_MANIFEST_SHA256,
    })).resolves.toEqual({
      success: true,
      termId: TERM_ID,
      year: 2026,
      term: 'fall',
      status: 'active',
      subjectCount: 1,
      completeSubjectCount: 1,
      removedSubjectCount: 1,
      deletedCourseCount: 2,
      coursesCount: 10,
      sectionsCount: 20,
      minimumLastSync: 1_700_000_000,
      earliestSubjectSync: 1_800_000_000,
      manifestSha256: CS_MANIFEST_SHA256,
      lastSynced: 1_800_000_000,
    });

    expect(getSubjectsForTerm).toHaveBeenCalledWith(
      expect.objectContaining({ cisapiBase: 'https://cis.example.test' }),
      2026,
      'fall',
    );
    expect(reconcileTermSubjectManifest).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        authoritativeSubjects: ['CS'],
        syncResult: expect.objectContaining({
          successfulSubjects: 1,
          failedSubjects: 0,
          pagination: {
            total: 1,
            offset: 0,
            limit: 1,
            hasMore: false,
          },
        }),
      }),
    );
    expect(recordCoordinatedTermSyncResult).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        termState: currentTerm,
        totalSubjects: 1,
      }),
    );
  });

  it('refuses missing or incomplete authoritative subject checkpoints', async () => {
    vi.mocked(getTermState).mockResolvedValue(termState());
    vi.mocked(getSubjectsForTerm).mockResolvedValue(['CS', 'MATH']);
    const db = subjectStateDb([[
      subjectState('CS'),
      subjectState('MATH', { status: 'running', last_sync: null }),
    ]]);

    await expect(finalizeTermSync(env(db), {
      year: 2026,
      term: 'fall',
      minimumLastSync: 1_700_000_000,
      expectedManifestSha256: CS_MATH_MANIFEST_SHA256,
    })).rejects.toThrow(/incomplete subject coverage.*MATH/);
    expect(reconcileTermSubjectManifest).not.toHaveBeenCalled();
    expect(recordCoordinatedTermSyncResult).not.toHaveBeenCalled();
  });

  it('refuses complete checkpoints older than the release lower bound', async () => {
    vi.mocked(getTermState).mockResolvedValue(termState());
    vi.mocked(getSubjectsForTerm).mockResolvedValue(['CS']);
    const db = subjectStateDb([[
      subjectState('CS', { last_sync: 1_699_999_999 }),
    ]]);

    await expect(finalizeTermSync(env(db), {
      year: 2026,
      term: 'fall',
      minimumLastSync: 1_700_000_000,
      expectedManifestSha256: CS_MANIFEST_SHA256,
    })).rejects.toThrow(/incomplete subject coverage.*CS/);
    expect(reconcileTermSubjectManifest).not.toHaveBeenCalled();
  });

  it('re-verifies exact coverage after manifest reconciliation', async () => {
    vi.mocked(getTermState).mockResolvedValue(termState());
    vi.mocked(getSubjectsForTerm).mockResolvedValue(['CS']);
    vi.mocked(reconcileTermSubjectManifest).mockResolvedValue({
      applied: true,
      deletedCourseCount: 0,
    });
    const db = subjectStateDb([
      [subjectState('CS'), subjectState('OLD')],
      [subjectState('CS'), subjectState('OLD')],
    ]);

    await expect(finalizeTermSync(env(db), {
      year: 2026,
      term: 'fall',
      minimumLastSync: 1_700_000_000,
      expectedManifestSha256: CS_MANIFEST_SHA256,
    })).rejects.toThrow(/non-authoritative subject coverage.*OLD/);
    expect(recordCoordinatedTermSyncResult).not.toHaveBeenCalled();
  });

  it('rejects a changed or implausibly shrunken authoritative manifest', async () => {
    vi.mocked(getTermState).mockResolvedValue(termState());
    vi.mocked(getSubjectsForTerm).mockResolvedValue(['CS']);

    await expect(finalizeTermSync(env(subjectStateDb([])), {
      year: 2026,
      term: 'fall',
      minimumLastSync: 1_700_000_000,
      expectedManifestSha256: '0'.repeat(64),
    })).rejects.toThrow(/manifest changed during paged sync/);

    vi.mocked(getTermState).mockResolvedValue(termState({
      subjects_count: 100,
    }));
    await expect(finalizeTermSync(env(subjectStateDb([])), {
      year: 2026,
      term: 'fall',
      minimumLastSync: 1_700_000_000,
      expectedManifestSha256: CS_MANIFEST_SHA256,
    })).rejects.toThrow(/implausible destructive subject shrink.*100 to 1/);
    expect(reconcileTermSubjectManifest).not.toHaveBeenCalled();
  });
});

function env(db: D1Database) {
  return {
    DB: db,
    CISAPI_BASE: 'https://cis.example.test',
    SYNC_CONCURRENCY: '5',
    SYNC_EMBEDDINGS: 'false',
  };
}

function subjectStateDb(reads: SubjectSyncState[][]): D1Database {
  let readIndex = 0;
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        all: vi.fn(async () => ({
          success: true,
          results: reads[readIndex++] ?? [],
        })),
      })),
    })),
  } as unknown as D1Database;
}

function termState(overrides: Partial<TermState> = {}): TermState {
  return {
    term_id: TERM_ID,
    year: 2026,
    term: 'fall',
    status: 'active',
    last_checked: 1,
    last_synced: null,
    subjects_count: null,
    courses_count: null,
    sections_count: null,
    sync_errors: null,
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

function subjectState(
  subject: string,
  overrides: Partial<SubjectSyncState> = {},
): SubjectSyncState {
  return {
    term_id: TERM_ID,
    subject,
    last_sync: 1_800_000_000,
    status: 'complete',
    courses_synced: 10,
    sections_synced: 20,
    error: null,
    ...overrides,
  };
}
