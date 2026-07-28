import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ai, D1Database, Fetcher, KVNamespace, VectorizeIndex } from '@cloudflare/workers-types';
import type { TermState } from '../../db/types.js';
import { syncSubjects, syncTerm } from '../../services/parallel-sync.js';
import { coordinateCourseSync } from '../../services/sync-coordinator.js';
import { syncRoutes } from '../sync.js';

vi.mock('../../services/parallel-sync.js', () => ({
  syncSubjects: vi.fn(),
  syncTerm: vi.fn(),
}));

vi.mock('../../services/sync-coordinator.js', () => ({
  coordinateCourseSync: vi.fn(),
}));

type RunCall = {
  sql: string;
  params: unknown[];
};

function createEnv(existingTerm: TermState | null, runCalls: RunCall[] = []) {
  const db = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...params: unknown[]) => ({
        first: vi.fn(async () => {
          if (sql.includes('FROM term_state')) return existingTerm;
          if (sql.includes('FROM courses')) return { count: 42 };
          if (sql.includes('FROM sections')) return { count: 99 };
          return null;
        }),
        all: vi.fn(async () => {
          if (sql.includes('FROM term_state') && sql.includes('WHERE status = ?')) {
            return {
              success: true,
              results: existingTerm && params[0] === existingTerm.status ? [existingTerm] : [],
            };
          }
          return { success: true, results: [] };
        }),
        run: vi.fn(async () => {
          runCalls.push({ sql, params });
          return { success: true };
        }),
      })),
    })),
  } as unknown as D1Database;

  return {
    DB: db,
    VECTORIZE: {} as VectorizeIndex,
    AI: {} as Ai,
    SELF: {} as Fetcher,
    GPA_CACHE: {} as KVNamespace,
    CURRENT_YEAR: '2026',
    CURRENT_TERM: 'fall',
    CISAPI_BASE: 'https://example.invalid',
    SYNC_CONCURRENCY: '1',
  };
}

function app(): Hono {
  const instance = new Hono();
  instance.route('/', syncRoutes);
  return instance;
}

function termState(overrides: Partial<TermState> = {}): TermState {
  return {
    term_id: '2026-fall',
    year: 2026,
    term: 'fall',
    status: 'registrable',
    last_checked: 100,
    last_synced: 111,
    subjects_count: 12,
    courses_count: 40,
    sections_count: 90,
    sync_errors: null,
    created_at: 1,
    updated_at: 2,
    ...overrides,
  };
}

describe('internal sync batch route', () => {
  beforeEach(() => {
    vi.mocked(syncSubjects).mockReset();
    vi.mocked(syncTerm).mockReset();
    vi.mocked(coordinateCourseSync).mockReset();
  });

  it('returns a fan-out batch result without claiming term-level freshness', async () => {
    vi.mocked(syncSubjects).mockResolvedValue({
      termId: '2026-fall',
      year: 2026,
      term: 'fall',
      subjectResults: [{ subject: 'CS', success: true, coursesCount: 2, sectionsCount: 3, durationMs: 1 }],
      totalCourses: 2,
      totalSections: 3,
      successfulSubjects: 1,
      failedSubjects: 0,
      durationMs: 1,
      rateLimitHits: 0,
      pagination: { total: 1, offset: 0, limit: 1, hasMore: false },
    });
    const runCalls: RunCall[] = [];

    const response = await app().request('/internal/sync-batch', {
      method: 'POST',
      body: JSON.stringify({
        year: 2026,
        term: 'fall',
        subjects: ['CS'],
        status: 'registrable',
        totalSubjects: 187,
        forceRunningLocks: true,
      }),
    }, createEnv(termState(), runCalls));

    expect(response.status).toBe(200);
    const termUpsert = runCalls.find(call => call.sql.includes('INSERT INTO term_state'));
    expect(termUpsert).toBeUndefined();
    expect(syncSubjects).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      2026,
      'fall',
      ['CS'],
      undefined,
      undefined,
      { lockMode: 'force' },
    );
  });

  it('rejects a non-boolean forceRunningLocks value', async () => {
    const response = await app().request('/internal/sync-batch', {
      method: 'POST',
      body: JSON.stringify({
        year: 2026,
        term: 'fall',
        subjects: ['CS'],
        forceRunningLocks: 'yes',
      }),
    }, createEnv(termState()));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'forceRunningLocks must be a boolean',
    });
    expect(syncSubjects).not.toHaveBeenCalled();
  });

  it('does not mark a skipped-only batch as freshly synced', async () => {
    vi.mocked(syncSubjects).mockResolvedValue({
      termId: '2026-fall',
      year: 2026,
      term: 'fall',
      subjectResults: [{ subject: 'CS', success: true, skipped: true, coursesCount: 0, sectionsCount: 0, durationMs: 1 }],
      totalCourses: 0,
      totalSections: 0,
      successfulSubjects: 1,
      failedSubjects: 0,
      durationMs: 1,
      rateLimitHits: 0,
      pagination: { total: 1, offset: 0, limit: 1, hasMore: false },
    });
    const runCalls: RunCall[] = [];

    const response = await app().request('/internal/sync-batch', {
      method: 'POST',
      body: JSON.stringify({
        year: 2026,
        term: 'fall',
        subjects: ['CS'],
        totalSubjects: 187,
      }),
    }, createEnv(termState({ last_synced: 111 }), runCalls));

    expect(response.status).toBe(200);
    const termUpsert = runCalls.find(call => call.sql.includes('INSERT INTO term_state'));
    expect(termUpsert).toBeUndefined();
  });

  it('rejects malformed year and term before syncing or upserting term_state', async () => {
    const runCalls: RunCall[] = [];

    const response = await app().request('/internal/sync-batch', {
      method: 'POST',
      body: JSON.stringify({
        year: '2026',
        term: 'autumn',
        subjects: ['CS'],
        totalSubjects: 1,
      }),
    }, createEnv(termState(), runCalls));

    expect(response.status).toBe(400);
    expect(vi.mocked(syncSubjects)).not.toHaveBeenCalled();
    expect(runCalls).toEqual([]);
  });

  it('rejects duplicate subject codes before syncing', async () => {
    const response = await app().request('/internal/sync-batch', {
      method: 'POST',
      body: JSON.stringify({
        year: 2026,
        term: 'fall',
        subjects: ['CS', 'cs'],
        totalSubjects: 2,
      }),
    }, createEnv(termState()));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('duplicates') });
    expect(vi.mocked(syncSubjects)).not.toHaveBeenCalled();
  });

  it('does not mark sync-active skipped-only terms as freshly synced', async () => {
    vi.mocked(syncTerm).mockResolvedValue({
      termId: '2026-fall',
      year: 2026,
      term: 'fall',
      subjectResults: [{ subject: 'CS', success: true, skipped: true, coursesCount: 0, sectionsCount: 0, durationMs: 1 }],
      totalCourses: 0,
      totalSections: 0,
      successfulSubjects: 1,
      failedSubjects: 0,
      durationMs: 1,
      rateLimitHits: 0,
      pagination: { total: 187, offset: 0, limit: 1, hasMore: true },
    });
    const runCalls: RunCall[] = [];

    const response = await app().request('/admin/sync-active', {
      method: 'POST',
    }, createEnv(termState({ last_synced: 111 }), runCalls));

    expect(response.status).toBe(200);
    const termUpsert = runCalls.find(call => call.sql.includes('INSERT INTO term_state'));
    expect(termUpsert?.params[4]).toEqual(expect.any(Number));
    expect(termUpsert?.params[5]).toBe(111);
    expect(termUpsert?.params.slice(6, 9)).toEqual([187, 42, 99]);
  });

  it('exposes the exact full coordinator result for release gating', async () => {
    vi.mocked(coordinateCourseSync).mockResolvedValue({
      termCount: 1,
      failedTermCount: 0,
      results: [{
        termId: '2026-fall',
        subjectCount: 187,
        batchCount: 10,
        failedBatchCount: 0,
        failedSubjectCount: 0,
        skippedSubjectCount: 0,
        deletedCourseCount: 2,
        success: true,
      }],
    });

    const response = await app().request(
      '/admin/sync-active/full',
      { method: 'POST' },
      createEnv(termState()),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      termCount: 1,
      failedTermCount: 0,
      results: [{
        termId: '2026-fall',
        deletedCourseCount: 2,
        success: true,
      }],
    });
    expect(coordinateCourseSync).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ trigger: 'admin_full_sync' }),
    );
  });
});
