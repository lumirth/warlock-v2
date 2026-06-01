import { beforeEach, describe, expect, it, vi } from 'vitest';
import { coordinateRmpSync } from '../rmp-sync.js';

type SyncStateRow = {
  last_sync: number | null;
  last_status: string | null;
  items_synced: number | null;
  cursor: number | null;
  etag: string | null;
};

function createDb(previous: SyncStateRow | null = null) {
  const stateWrites: unknown[][] = [];

  const db = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...args: unknown[]) => ({
        first: vi.fn(async () => sql.includes('SELECT last_sync') ? previous : null),
        run: vi.fn(async () => {
          stateWrites.push(args);
          return {};
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
              legacyId: 1,
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
  });

  it('requires the RMP auth binding instead of relying on a hardcoded token', async () => {
    const { db } = createDb();
    const selfBinding = { fetch: vi.fn() };

    await expect(coordinateRmpSync(db as any, selfBinding as any)).rejects.toThrow('RMP_AUTH_TOKEN');
    expect(selfBinding.fetch).not.toHaveBeenCalled();
  });

  it('records resumable sync_state checkpoints while dispatching pages', async () => {
    const { db, stateWrites } = createDb();
    const selfBinding = { fetch: vi.fn(async () => new Response(null, { status: 202 })) };
    mockRmpResponse('cursor-1');

    const result = await coordinateRmpSync(db as any, selfBinding as any, {
      rmpAuthToken: 'Basic public-token',
      internalToken: 'internal-token',
    });

    expect(result).toEqual({ count: 1, pages: 1 });
    expect(stateWrites[0]).toEqual(['rmp', 'running', 0, 0, null]);
    expect(stateWrites.at(-1)).toEqual(['rmp', 'complete', 1, 1, 'cursor-1']);
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
    const selfBinding = { fetch: vi.fn(async () => new Response(null, { status: 202 })) };
    mockRmpResponse('new-cursor');

    const result = await coordinateRmpSync(db as any, selfBinding as any, {
      rmpAuthToken: 'Basic public-token',
    });

    expect(result).toEqual({ count: 101, pages: 4 });
    const fetchBody = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(fetchBody.variables.cursor).toBe('stored-cursor');
    expect(stateWrites.at(-1)).toEqual(['rmp', 'complete', 101, 4, 'new-cursor']);
  });
});
