import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syncSubjects } from '../parallel-sync.js';
import { browserFetch } from '../../http/browser-fetch.js';
import { parseSubjectCascadeXml } from '../../cisapi/parser.js';
import { writeSubjectSnapshotToD1 } from '../course-snapshot-writer.js';
import { deleteCourseEmbeddings, upsertCourseEmbeddingsInBatches } from '../embeddings.js';
import { fromSubjectCascade } from '../../transforms/course.js';
import type { Ai, D1Database, VectorizeIndex } from '@cloudflare/workers-types';
import type { SyncRunStatus } from '../../db/types.js';

vi.mock('../../http/browser-fetch.js', () => ({
  browserFetch: vi.fn(),
}));
vi.mock('../../cisapi/parser.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../cisapi/parser.js')>()),
  parseSubjectCascadeXml: vi.fn(),
}));
vi.mock('../course-snapshot-writer.js', () => ({
  writeSubjectSnapshotToD1: vi.fn(),
}));
vi.mock('../embeddings.js', () => ({
  courseSnapshotToEmbeddingData: vi.fn((snapshot: { course: { id: string } }) => ({
    id: snapshot.course.id,
  })),
  deleteCourseEmbeddings: vi.fn(),
  upsertCourseEmbeddingsInBatches: vi.fn(),
}));
vi.mock('../../transforms/course.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../transforms/course.js')>()),
  fromSubjectCascade: vi.fn(),
}));
vi.mock('../validation.js', () => ({
  assertPublishableSubjectSnapshot: vi.fn(),
}));

function successfulSyncDb(existingCourseIds: string[] = []) {
  const writes: unknown[][] = [];
  const db = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...args: unknown[]) => ({
        first: vi.fn(async () => null),
        all: vi.fn(async () => ({
          success: true,
          results: existingCourseIds.map(id => ({ id })),
        })),
        run: vi.fn(async () => {
          writes.push([sql.replace(/\s+/g, ' ').trim(), ...args]);
          return { meta: { changes: 1 } };
        }),
      })),
    })),
  };
  return { db, writes };
}

function prepareSuccessfulSubjectSync() {
  vi.mocked(browserFetch).mockResolvedValueOnce(new Response('<xml/>', { status: 200 }));
  vi.mocked(parseSubjectCascadeXml).mockResolvedValueOnce({ subjectId: 'CS' } as never);
  vi.mocked(fromSubjectCascade).mockReturnValueOnce({
    subject: { id: 'CS' },
    courses: [
      { course: { id: 'CS-124-2026-spring' } },
      { course: { id: 'CS-225-2026-spring' } },
    ],
  } as never);
  vi.mocked(writeSubjectSnapshotToD1).mockResolvedValueOnce({
    coursesCount: 2,
    sectionsCount: 3,
  });
}

describe('syncSubjects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips a subject when a fresh running sync lock already exists', async () => {
    const db = {
      prepare: vi.fn((_sql: string) => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () => null),
          run: vi.fn(async () => ({ meta: { changes: 0 } })),
        })),
      })),
    };

    const result = await syncSubjects(
      db as unknown as D1Database,
      { cisapiBase: 'https://example.invalid', concurrency: 1 },
      2026,
      'spring',
      ['CS']
    );

    expect(result.subjectResults).toEqual([
      expect.objectContaining({
        subject: 'CS',
        success: true,
        skipped: true,
        coursesCount: 0,
        sectionsCount: 0,
      }),
    ]);
    expect(db.prepare).toHaveBeenCalledTimes(1);
  });

  it('force-refreshes a subject even when a fresh running sync lock exists', async () => {
    vi.mocked(browserFetch).mockResolvedValueOnce(new Response('', { status: 404 }));
    const writes: unknown[][] = [];
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn((...args: unknown[]) => ({
          first: vi.fn(async () => null),
          run: vi.fn(async () => {
            writes.push([sql.replace(/\s+/g, ' ').trim(), ...args]);
            return { meta: { changes: 1 } };
          }),
        })),
      })),
    };

    const result = await syncSubjects(
      db as unknown as D1Database,
      { cisapiBase: 'https://example.invalid', concurrency: 1 },
      2026,
      'spring',
      ['CS'],
      undefined,
      undefined,
      { lockMode: 'force' }
    );

    expect(result.subjectResults).toEqual([
      expect.objectContaining({
        subject: 'CS',
        success: false,
        error: 'HTTP 404 for CS',
      }),
    ]);
    expect(result.subjectResults[0]).not.toHaveProperty('skipped');
    expect(writes.some(write => String(write[0]).includes('INSERT INTO subject_sync_state'))).toBe(true);
  });

  it('publishes D1 before upserting current vectors and pruning stale vectors', async () => {
    prepareSuccessfulSubjectSync();
    const { db, writes } = successfulSyncDb([
      'CS-124-2026-spring',
      'CS-125-2026-spring',
    ]);

    const result = await syncSubjects(
      db as unknown as D1Database,
      { cisapiBase: 'https://example.invalid', concurrency: 1 },
      2026,
      'spring',
      ['CS'],
      {} as VectorizeIndex,
      {} as Ai,
    );

    expect(upsertCourseEmbeddingsInBatches).toHaveBeenCalledTimes(1);
    expect(deleteCourseEmbeddings).toHaveBeenCalledWith(
      expect.anything(),
      ['CS-125-2026-spring']
    );
    expect(vi.mocked(writeSubjectSnapshotToD1).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(upsertCourseEmbeddingsInBatches).mock.invocationCallOrder[0]);
    expect(vi.mocked(upsertCourseEmbeddingsInBatches).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(deleteCourseEmbeddings).mock.invocationCallOrder[0]);
    expect(result.failedSubjects).toBe(0);
    expect(writeSubjectSnapshotToD1).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        publicationFence: {
          termId: '2026-spring',
          subject: 'CS',
          ownerToken: expect.stringMatching(/^subject:/),
        },
      }
    );
    expect(writes.at(-1)).toEqual(expect.arrayContaining([
      expect.stringContaining('UPDATE subject_sync_state'),
      'complete',
      '2026-spring',
      'CS',
    ]));
  });

  it('marks the subject failed when semantic indexing fails', async () => {
    prepareSuccessfulSubjectSync();
    vi.mocked(upsertCourseEmbeddingsInBatches).mockRejectedValueOnce(new Error('vector write failed'));
    const { db, writes } = successfulSyncDb();

    const result = await syncSubjects(
      db as unknown as D1Database,
      { cisapiBase: 'https://example.invalid', concurrency: 1 },
      2026,
      'spring',
      ['CS'],
      {} as VectorizeIndex,
      {} as Ai,
    );

    expect(result.failedSubjects).toBe(1);
    expect(result.subjectResults[0]).toEqual(expect.objectContaining({
      success: false,
      error: 'vector write failed',
    }));
    expect(writes.at(-1)).toEqual(expect.arrayContaining([
      expect.stringContaining('UPDATE subject_sync_state'),
      'failed',
      '2026-spring',
      'CS',
    ]));
  });

  it('fences a stale worker after a forced takeover and preserves the new owner status', async () => {
    let resolveFirstParse: ((parsed: { subjectId: string }) => void) | undefined;
    const firstParse = new Promise<{ subjectId: string }>(resolve => {
      resolveFirstParse = resolve;
    });
    vi.mocked(browserFetch)
      .mockResolvedValueOnce(new Response('<xml/>', { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 404 }));
    vi.mocked(parseSubjectCascadeXml).mockReturnValueOnce(firstParse as never);
    vi.mocked(fromSubjectCascade).mockReturnValueOnce({
      subject: { id: 'CS' },
      courses: [{ course: { id: 'CS-124-2026-spring' } }],
    } as never);

    const state: {
      ownerToken: string | null;
      status: SyncRunStatus | null;
      error: string | null;
    } = {
      ownerToken: null,
      status: null,
      error: null,
    };
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn((...args: unknown[]) => ({
          run: vi.fn(async () => {
            const normalized = sql.replace(/\s+/g, ' ').trim();
            if (normalized.startsWith('INSERT INTO subject_sync_state')) {
              const requestedOwner = String(args[2]);
              const force = args[3] === 1;
              if (state.ownerToken === null || force) {
                state.ownerToken = requestedOwner;
                state.status = 'running';
                state.error = null;
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            }

            if (
              normalized.startsWith('UPDATE subject_sync_state')
              && normalized.includes('status = ?')
            ) {
              const requestedOwner = String(args[6]);
              if (state.ownerToken !== requestedOwner || state.status !== 'running') {
                return { meta: { changes: 0 } };
              }
              state.status = args[0] as SyncRunStatus;
              state.error = args[3] === null ? null : String(args[3]);
              state.ownerToken = null;
              return { meta: { changes: 1 } };
            }

            if (normalized.startsWith('UPDATE subject_sync_state')) {
              const requestedOwner = String(args[2]);
              return {
                meta: {
                  changes: state.ownerToken === requestedOwner
                    && state.status === 'running'
                    ? 1
                    : 0,
                },
              };
            }
            return { meta: { changes: 0 } };
          }),
        })),
      })),
    };

    const staleRun = syncSubjects(
      db as unknown as D1Database,
      { cisapiBase: 'https://example.invalid', concurrency: 1 },
      2026,
      'spring',
      ['CS']
    );
    await vi.waitFor(() => {
      expect(parseSubjectCascadeXml).toHaveBeenCalledTimes(1);
    });

    const takeoverRun = syncSubjects(
      db as unknown as D1Database,
      { cisapiBase: 'https://example.invalid', concurrency: 1 },
      2026,
      'spring',
      ['CS'],
      undefined,
      undefined,
      { lockMode: 'force' }
    );
    const takeoverResult = await takeoverRun;
    resolveFirstParse?.({ subjectId: 'CS' });
    const staleResult = await staleRun;

    expect(takeoverResult.subjectResults[0]).toEqual(expect.objectContaining({
      success: false,
      error: 'HTTP 404 for CS',
    }));
    expect(staleResult.subjectResults[0]).toEqual(expect.objectContaining({
      success: false,
      error: 'Subject sync lease ownership changed; refusing stale data publication',
    }));
    expect(writeSubjectSnapshotToD1).not.toHaveBeenCalled();
    expect(state).toEqual({
      ownerToken: null,
      status: 'failed',
      error: 'HTTP 404 for CS',
    });
  });
});
