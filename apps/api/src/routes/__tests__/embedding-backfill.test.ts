import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { Ai, D1Database, Fetcher, KVNamespace, VectorizeIndex } from '@cloudflare/workers-types';
import { backfillCourseEmbeddings } from '../../services/embedding-backfill-service.js';
import { syncRoutes } from '../sync.js';

vi.mock('../../services/embedding-backfill-service.js', () => ({
  backfillCourseEmbeddings: vi.fn(),
}));

function app(): Hono {
  const instance = new Hono();
  instance.route('/', syncRoutes);
  return instance;
}

function env() {
  return {
    DB: {} as D1Database,
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

describe('embedding backfill route', () => {
  it('defaults to active-scope bounded backfill', async () => {
    vi.mocked(backfillCourseEmbeddings).mockResolvedValue({
      scope: 'active',
      limit: 100,
      offset: 0,
      total: 2,
      processed: 2,
      hasMore: false,
      firstCourseId: 'CS-124-2026-fall',
      lastCourseId: 'CS-225-2026-fall',
    });

    const bindings = env();
    const response = await app().request('/admin/embeddings/backfill', {
      method: 'POST',
    }, bindings);

    await expect(response.json()).resolves.toMatchObject({
      scope: 'active',
      processed: 2,
      hasMore: false,
    });
    expect(backfillCourseEmbeddings).toHaveBeenCalledWith(
      bindings.DB,
      bindings.VECTORIZE,
      bindings.AI,
      {
        scope: 'active',
        limit: 100,
        offset: 0,
        year: undefined,
        term: undefined,
      },
    );
  });

  it('accepts explicit all-scope term batches', async () => {
    vi.mocked(backfillCourseEmbeddings).mockResolvedValue({
      scope: 'all',
      year: 2026,
      term: 'fall',
      limit: 25,
      offset: 50,
      total: 100,
      processed: 25,
      hasMore: true,
      firstCourseId: 'AAS-100-2026-fall',
      lastCourseId: 'CS-124-2026-fall',
    });

    const response = await app().request('/admin/embeddings/backfill?scope=all&year=2026&term=fall&limit=25&offset=50', {
      method: 'POST',
    }, env());

    expect(response.status).toBe(200);
    expect(backfillCourseEmbeddings).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      {
        scope: 'all',
        limit: 25,
        offset: 50,
        year: 2026,
        term: 'fall',
      },
    );
  });

  it('rejects unsafe batch sizes', async () => {
    const response = await app().request('/admin/embeddings/backfill?limit=1000', {
      method: 'POST',
    }, env());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'limit must be between 1 and 250',
    });
  });
});
