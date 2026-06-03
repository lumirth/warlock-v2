import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ai, D1Database, Fetcher, KVNamespace, RateLimit, VectorizeIndex } from '@cloudflare/workers-types';
import worker from '../index.js';
import { coordinateEnrichment } from '../services/enrichment.js';
import { resetGpaSync } from '../services/gpa-sync.js';
import { coordinateRmpSync } from '../services/rmp-sync.js';

vi.mock('../services/enrichment.js', () => ({
  coordinateEnrichment: vi.fn(),
  enrichCoursesWithGpa: vi.fn(),
  enrichCoursesWithScores: vi.fn(),
}));

vi.mock('../services/gpa-sync.js', () => ({
  resetGpaSync: vi.fn(),
  resumeGpaSync: vi.fn(),
}));

vi.mock('../services/rmp-sync.js', () => ({
  coordinateRmpSync: vi.fn(),
}));

type TestExecutionContext = ExecutionContext & {
  promises: Promise<unknown>[];
};

function executionContext(): TestExecutionContext {
  const promises: Promise<unknown>[] = [];
  return {
    promises,
    waitUntil: vi.fn((promise: Promise<unknown>) => {
      promises.push(promise);
    }),
    passThroughOnException: vi.fn(),
    props: {},
  } as unknown as TestExecutionContext;
}

function env() {
  const limiter = { limit: vi.fn(async () => ({ success: true })) } as unknown as RateLimit;
  return {
    DB: {} as D1Database,
    VECTORIZE: {} as VectorizeIndex,
    AI: {} as Ai,
    SELF: {} as Fetcher,
    GPA_CACHE: {} as KVNamespace,
    SEARCH_RATE_LIMITER: limiter,
    COURSE_RATE_LIMITER: limiter,
    CURRENT_YEAR: '2026',
    CURRENT_TERM: 'fall',
    CISAPI_BASE: 'https://example.invalid',
    FRONTEND_BASE: 'https://example.invalid',
    SYNC_CONCURRENCY: '1',
    BACKOFF_BASE_MS: '100',
    BACKOFF_MAX_MS: '1000',
    MAX_RETRIES: '3',
    CLIENT_CACHE_TTL_MS: '60000',
    INTERNAL_TOKEN: 'internal-token',
    RMP_AUTH_TOKEN: 'Basic public-token',
  };
}

describe('scheduled worker', () => {
  beforeEach(() => {
    vi.mocked(resetGpaSync).mockReset();
    vi.mocked(coordinateRmpSync).mockReset();
    vi.mocked(coordinateEnrichment).mockReset();
  });

  it('runs enrichment after weekly RMP sync completes', async () => {
    const callOrder: string[] = [];
    vi.mocked(resetGpaSync).mockResolvedValue('reset');
    vi.mocked(coordinateRmpSync).mockImplementation(async () => {
      callOrder.push('rmp');
      return { count: 1, pages: 1 };
    });
    vi.mocked(coordinateEnrichment).mockImplementation(async () => {
      callOrder.push('enrichment');
      return { taskCount: 2, batchCount: 1, linkCount: 2, scoreUpdateCount: 3 };
    });

    const ctx = executionContext();
    const environment = env();
    await worker.scheduled({ cron: '0 8 * * 0' } as ScheduledEvent, environment, ctx);
    await Promise.all(ctx.promises);

    expect(callOrder).toEqual(['rmp', 'enrichment']);
    expect(coordinateEnrichment).toHaveBeenCalledWith(environment.DB, environment.SELF, 'internal-token');
  });
});
