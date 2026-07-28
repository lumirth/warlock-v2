import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ai, D1Database, Fetcher, KVNamespace, VectorizeIndex } from '@cloudflare/workers-types';
import { coordinateEnrichment } from '../../services/enrichment.js';
import { coordinateRmpSync, processRmpBatch, type RmpTeacherNode } from '../../services/rmp-sync.js';
import { syncRoutes } from '../sync.js';

vi.mock('../../services/enrichment.js', () => ({
  coordinateEnrichment: vi.fn(),
  enrichCoursesWithGpa: vi.fn(),
  enrichCoursesWithScores: vi.fn(),
}));

vi.mock('../../services/rmp-sync.js', () => ({
  coordinateRmpSync: vi.fn(),
  processRmpBatch: vi.fn(),
}));

const teacher: RmpTeacherNode = {
  id: 'Teacher-1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  avgRating: 5,
  numRatings: 10,
  avgDifficulty: 2,
  department: 'Computer Science',
  wouldTakeAgainPercent: 100,
  teacherRatingTags: [],
};

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
    INTERNAL_TOKEN: 'internal-token',
    RMP_AUTH_TOKEN: 'Basic public-token',
  };
}

describe('RMP sync routes', () => {
  beforeEach(() => {
    vi.mocked(coordinateRmpSync).mockReset();
    vi.mocked(processRmpBatch).mockReset();
    vi.mocked(coordinateEnrichment).mockReset();
  });

  it('processes internal RMP batches before returning success', async () => {
    let processed = false;
    vi.mocked(processRmpBatch).mockImplementation(async () => {
      processed = true;
    });
    const environment = env();

    const response = await app().request('/internal/sync-rmp-batch', {
      method: 'POST',
      body: JSON.stringify({ teachers: [teacher] }),
    }, environment);

    expect(response.status).toBe(200);
    expect(processed).toBe(true);
    expect(processRmpBatch).toHaveBeenCalledWith(environment.DB, [teacher]);
    await expect(response.json()).resolves.toMatchObject({
      status: 'complete',
      count: 1,
    });
  });

  it('runs active-term enrichment after admin RMP sync completes', async () => {
    const callOrder: string[] = [];
    vi.mocked(coordinateRmpSync).mockImplementation(async () => {
      callOrder.push('rmp');
      return { count: 1, pages: 1 };
    });
    vi.mocked(coordinateEnrichment).mockImplementation(async () => {
      callOrder.push('enrichment');
      return { taskCount: 2, batchCount: 1, linkCount: 2, scoreUpdateCount: 3 };
    });
    const environment = env();

    const response = await app().request('/admin/sync-rmp', { method: 'POST' }, environment);

    expect(response.status).toBe(200);
    expect(callOrder).toEqual(['rmp', 'enrichment']);
    await expect(response.json()).resolves.toMatchObject({
      count: 1,
      pages: 1,
      enrichment: {
        taskCount: 2,
        batchCount: 1,
        linkCount: 2,
        scoreUpdateCount: 3,
      },
    });
  });
});
