import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { coordinateRmpSync, processRmpBatch, type RmpTeacherNode } from '../rmp-sync.js';

const db = (env as { DB: D1Database }).DB;

describe('RMP sync ownership', () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    await db.prepare("DELETE FROM sync_state WHERE id = 'rmp'").run();
    await db.prepare("DELETE FROM rmp_cache WHERE rmp_id LIKE 'test-%'").run();
  });

  it('fences an expired worker before it writes a stale page', async () => {
    const firstStarted = deferred();
    const releaseFirst = deferred();
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        firstStarted.resolve();
        await releaseFirst.promise;
      }
      return Response.json(page(calls === 1 ? 'test-stale' : 'test-current'));
    }));

    const stale = coordinateRmpSync(db, 'token');
    await firstStarted.promise;
    await db.prepare("UPDATE sync_state SET last_sync = 0 WHERE id = 'rmp'").run();
    await expect(coordinateRmpSync(db, 'token')).resolves.toEqual({ count: 1, pages: 1 });
    releaseFirst.resolve();
    await expect(stale).rejects.toThrow('refusing stale RMP write');

    const teachers = await db.prepare(`
      SELECT rmp_id FROM rmp_cache WHERE rmp_id LIKE 'test-%' ORDER BY rmp_id
    `).all<{ rmp_id: string }>();
    expect(teachers.results).toEqual([{ rmp_id: 'test-current' }]);
  });

  it('upserts a full provider page through one D1 statement', async () => {
    const teachers = Array.from({ length: 1_000 }, (_, index): RmpTeacherNode => ({
      id: `test-bulk-${index}`,
      firstName: 'Ada',
      lastName: `Teacher${index}`,
      avgRating: 4.5,
      numRatings: 10,
      avgDifficulty: 3,
      wouldTakeAgainPercent: 90,
    }));

    await processRmpBatch(db, teachers);
    const count = await db.prepare(
      "SELECT COUNT(*) AS count FROM rmp_cache WHERE rmp_id LIKE 'test-bulk-%'",
    ).first<{ count: number }>();
    expect(count?.count).toBe(1_000);
  });
});

function page(id: string) {
  return { data: { newSearch: { teachers: {
    edges: [{ node: {
      id, firstName: 'Ada', lastName: 'Lovelace', avgRating: 4.8,
      numRatings: 10, avgDifficulty: 3, wouldTakeAgainPercent: 90,
    } }],
    pageInfo: { hasNextPage: false, endCursor: null },
  } } } };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
