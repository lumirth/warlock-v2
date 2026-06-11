import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ai, D1Database, Fetcher, KVNamespace, RateLimit, VectorizeIndex } from '@cloudflare/workers-types';
import worker from '../index.js';
import { coordinateEnrichment } from '../services/enrichment.js';
import { resetGpaSync, resumeGpaSync } from '../services/gpa-sync.js';
import { coordinateRmpSync } from '../services/rmp-sync.js';
import { coordinateCourseSync } from '../services/sync-coordinator.js';
import {
  dispatchScheduledWorkflows,
  planScheduledWorkflows,
} from '../services/scheduled-workflows.js';

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

vi.mock('../services/sync-coordinator.js', () => ({
  coordinateCourseSync: vi.fn(),
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
    vi.mocked(resumeGpaSync).mockReset();
    vi.mocked(coordinateRmpSync).mockReset();
    vi.mocked(coordinateEnrichment).mockReset();
    vi.mocked(coordinateCourseSync).mockReset();
  });

  it('makes the five-minute GPA cron course-sync fallthrough explicit', () => {
    expect(planScheduledWorkflows('*/5 * * * *')).toEqual({
      cron: '*/5 * * * *',
      workflows: [
        { name: 'gpa_resume', trigger: 'gpa_resume_cron' },
        { name: 'course_sync', trigger: 'gpa_resume_fallthrough' },
      ],
    });
  });

  it('routes unknown cron schedules to default course sync', () => {
    expect(planScheduledWorkflows('17 * * * *')).toEqual({
      cron: '17 * * * *',
      workflows: [{ name: 'course_sync', trigger: 'default_cron' }],
    });
  });

  it('dispatches scheduled workflows without depending on Cloudflare event objects', async () => {
    vi.mocked(coordinateCourseSync).mockResolvedValue({
      termCount: 1,
      results: [],
      failedTermCount: 0,
    });

    const promises: Promise<void>[] = [];
    const environment = env();
    const plan = dispatchScheduledWorkflows({
      cron: '17 * * * *',
      env: environment,
      waitUntil: promise => promises.push(promise),
    });
    await Promise.all(promises);

    expect(plan).toEqual({
      cron: '17 * * * *',
      workflows: [{ name: 'course_sync', trigger: 'default_cron' }],
    });
    expect(coordinateCourseSync).toHaveBeenCalledWith(environment, expect.objectContaining({
      cron: '17 * * * *',
      trigger: 'default_cron',
    }));
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
    expect(coordinateEnrichment).toHaveBeenCalledWith(environment.DB);
  });

  it('dispatches course sync through the coordinator for default cron schedules', async () => {
    vi.mocked(coordinateCourseSync).mockResolvedValue({
      termCount: 1,
      results: [],
      failedTermCount: 0,
    });

    const ctx = executionContext();
    const environment = env();
    await worker.scheduled({ cron: '17 * * * *' } as ScheduledEvent, environment, ctx);
    await Promise.all(ctx.promises);

    expect(coordinateCourseSync).toHaveBeenCalledWith(environment, expect.objectContaining({
      cron: '17 * * * *',
      trigger: 'default_cron',
    }));
  });
});
