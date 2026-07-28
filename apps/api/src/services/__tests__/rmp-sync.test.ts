import { beforeEach, describe, expect, it, vi } from 'vitest';
import { coordinateRmpSync, processRmpBatch, type RmpTeacherNode } from '../rmp-sync.js';
import type { D1Database, Fetcher } from '@cloudflare/workers-types';

type SyncStateRow = {
  last_sync: number | null;
  last_status: string | null;
  items_synced: number | null;
  cursor: number | null;
  etag: string | null;
};

function createDb(
  previous: SyncStateRow | null = null,
  options: {
    leaseChanges?: number;
    leaseRenewChanges?: number[];
  } = {},
) {
  const stateWrites: unknown[][] = [];
  let leaseRenewIndex = 0;

  const db = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...args: unknown[]) => ({
        first: vi.fn(async () => sql.includes('SELECT * FROM sync_state') ? previous : null),
        run: vi.fn(async () => {
          if (args[0] === 'rmp') stateWrites.push(args);
          const isLeaseClaim = sql.includes('INSERT INTO sync_state')
            && args[0] === 'rmp-sync-lease';
          const isLeaseRenew = sql.includes('SET last_sync = unixepoch()')
            && !sql.includes("last_status = 'complete'")
            && args[0] === 'rmp-sync-lease';
          return {
            meta: {
              changes: isLeaseClaim
                ? options.leaseChanges ?? 1
                : isLeaseRenew
                  ? options.leaseRenewChanges?.[leaseRenewIndex++] ?? 1
                  : 1,
            },
          };
        }),
      })),
    })),
  };

  return { db, stateWrites };
}

function mockRmpResponse(endCursor: string | null, hasNextPage = false) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    data: {
      newSearch: {
        teachers: {
          edges: [{
            cursor: endCursor ?? 'cursor-final',
            node: {
              id: 'Teacher-1',
              firstName: 'Ada',
              lastName: 'Lovelace',
              avgRating: 5,
              numRatings: 10,
              avgDifficulty: 2,
              department: 'Computer Science',
              wouldTakeAgainPercent: 100,
              teacherRatingTags: [],
            },
          }],
          pageInfo: { hasNextPage, endCursor },
          resultCount: 1,
        },
      },
    },
  }), { status: 200 })));
}

describe('coordinateRmpSync', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('rejects a fresh running lock', async () => {
    vi.setSystemTime(new Date('2026-06-01T12:00:00Z'));
    const previous: SyncStateRow = {
      last_sync: Math.floor(Date.now() / 1000) - 60,
      last_status: 'running',
      items_synced: 10,
      cursor: 1,
      etag: 'cursor-running',
    };
    const { db } = createDb(previous);
    const selfBinding = { fetch: vi.fn() };
    mockRmpResponse('new-cursor');

    await expect(coordinateRmpSync(db as unknown as D1Database, selfBinding as unknown as Fetcher, {
      rmpAuthToken: 'Basic public-token',
    })).rejects.toThrow('RMP sync is already running.');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses one atomic D1 write to reject an overlapping coordinator', async () => {
    const { db } = createDb(null, { leaseChanges: 0 });
    const selfBinding = { fetch: vi.fn() };
    mockRmpResponse('new-cursor');

    await expect(coordinateRmpSync(
      db as unknown as D1Database,
      selfBinding as unknown as Fetcher,
      { rmpAuthToken: 'Basic public-token' },
    )).rejects.toThrow('RMP sync is already running.');

    const claimSql = String(vi.mocked(db.prepare).mock.calls[0]?.[0] ?? '');
    expect(claimSql).toContain('ON CONFLICT(id) DO UPDATE SET');
    expect(claimSql).toContain("sync_state.last_status != 'running'");
    expect(fetch).not.toHaveBeenCalled();
    expect(selfBinding.fetch).not.toHaveBeenCalled();
  });

  it('refuses to dispatch a fetched page after lease ownership changes', async () => {
    const { db } = createDb(null, {
      // Initial state publication, pre-fetch heartbeat, then post-fetch fence.
      leaseRenewChanges: [1, 1, 0, 0],
    });
    const selfBinding = {
      fetch: vi.fn(async () => new Response(null, { status: 200 })),
    };
    mockRmpResponse('new-cursor');

    await expect(coordinateRmpSync(
      db as unknown as D1Database,
      selfBinding as unknown as Fetcher,
      { rmpAuthToken: 'Basic public-token' },
    )).rejects.toThrow('refusing stale failure checkpoint');

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(selfBinding.fetch).not.toHaveBeenCalled();
  });

  it('resumes an expired running lock from the stored cursor', async () => {
    vi.setSystemTime(new Date('2026-06-01T12:00:00Z'));
    const previous: SyncStateRow = {
      last_sync: Math.floor(Date.now() / 1000) - (2 * 60 * 60),
      last_status: 'running',
      items_synced: 25,
      cursor: 2,
      etag: 'expired-cursor',
    };
    const { db, stateWrites } = createDb(previous);
    const selfBinding = { fetch: vi.fn(async () => new Response(null, { status: 200 })) };
    mockRmpResponse('new-cursor');

    const result = await coordinateRmpSync(db as unknown as D1Database, selfBinding as unknown as Fetcher, {
      rmpAuthToken: 'Basic public-token',
    });

    expect(result).toEqual({ count: 26, pages: 3 });
    const fetchBody = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(fetchBody.variables.cursor).toBe('expired-cursor');
    expect(stateWrites.at(-1)).toEqual([
      'rmp',
      expect.any(Number),
      'complete',
      26,
      3,
      'new-cursor',
    ]);
  });

  it('requires the RMP auth binding instead of relying on a hardcoded token', async () => {
    const { db } = createDb();
    const selfBinding = { fetch: vi.fn() };

    await expect(coordinateRmpSync(
      db as unknown as D1Database,
      selfBinding as unknown as Fetcher
    )).rejects.toThrow('RMP_AUTH_TOKEN');
    expect(selfBinding.fetch).not.toHaveBeenCalled();
  });

  it('records resumable sync_state checkpoints while dispatching pages', async () => {
    const { db, stateWrites } = createDb();
    const selfBinding = { fetch: vi.fn(async () => new Response(null, { status: 200 })) };
    mockRmpResponse('cursor-1');

    const result = await coordinateRmpSync(db as unknown as D1Database, selfBinding as unknown as Fetcher, {
      rmpAuthToken: 'Basic public-token',
      internalToken: 'internal-token',
    });

    expect(result).toEqual({ count: 1, pages: 1 });
    expect(stateWrites[0]).toEqual(['rmp', expect.any(Number), 'running', 0, 0, null]);
    expect(stateWrites.at(-1)).toEqual([
      'rmp',
      expect.any(Number),
      'complete',
      1,
      1,
      'cursor-1',
    ]);
    expect(selfBinding.fetch).toHaveBeenCalledWith(
      'http://internal/internal/sync-rmp-batch',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer internal-token',
        }),
      })
    );
    expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toMatchObject({
      Authorization: 'Basic public-token',
    });
  });

  it('resumes a failed run from the stored cursor', async () => {
    const previous: SyncStateRow = {
      last_sync: 123,
      last_status: 'failed',
      items_synced: 100,
      cursor: 3,
      etag: 'stored-cursor',
    };
    const { db, stateWrites } = createDb(previous);
    const selfBinding = { fetch: vi.fn(async () => new Response(null, { status: 200 })) };
    mockRmpResponse('new-cursor');

    const result = await coordinateRmpSync(db as unknown as D1Database, selfBinding as unknown as Fetcher, {
      rmpAuthToken: 'Basic public-token',
    });

    expect(result).toEqual({ count: 101, pages: 4 });
    const fetchBody = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(fetchBody.variables.cursor).toBe('stored-cursor');
    expect(stateWrites.at(-1)).toEqual([
      'rmp',
      expect.any(Number),
      'complete',
      101,
      4,
      'new-cursor',
    ]);
  });
});

describe('processRmpBatch', () => {
  it('stores distinct full identities by stable RMP id without direct propagation', async () => {
    const boundRows: unknown[][] = [];
    const db = {
      prepare: vi.fn((_sql: string) => ({
        bind: vi.fn((...args: unknown[]) => {
          boundRows.push(args);
          return { run: vi.fn(async () => ({})) };
        }),
      })),
      batch: vi.fn(async () => []),
    };
    const teachers: RmpTeacherNode[] = [
      {
        id: 'Teacher-1',
        firstName: 'Ada',
        lastName: 'Lovelace',
        avgRating: 5,
        numRatings: 10,
        avgDifficulty: 2,
        department: 'Computer Science',
        wouldTakeAgainPercent: 100,
        teacherRatingTags: [
          { tagName: 'Helpful', tagCount: 1 },
          { tagName: 'Clear', tagCount: 2 },
        ],
      },
      {
        id: 'Teacher-2',
        firstName: 'Grace',
        lastName: 'Hopper',
        avgRating: 4.8,
        numRatings: 20,
        avgDifficulty: 2.2,
        department: 'Computer Science',
        wouldTakeAgainPercent: 98,
        teacherRatingTags: [],
      },
    ];

    await processRmpBatch(db as unknown as D1Database, teachers);

    expect(db.batch).toHaveBeenCalledTimes(1);
    expect(db.prepare).toHaveBeenCalledTimes(2);
    expect(vi.mocked(db.prepare).mock.calls.every(([sql]) =>
      sql.includes('ON CONFLICT(rmp_id)')
    )).toBe(true);
    expect(boundRows[0].slice(0, 4)).toEqual([
      'Lovelace, Ada',
      'Ada',
      'Lovelace',
      'Teacher-1',
    ]);
    expect(boundRows[1].slice(0, 4)).toEqual([
      'Hopper, Grace',
      'Grace',
      'Hopper',
      'Teacher-2',
    ]);
    expect(teachers[0].teacherRatingTags.map(tag => tag.tagName)).toEqual([
      'Helpful',
      'Clear',
    ]);
  });
});
