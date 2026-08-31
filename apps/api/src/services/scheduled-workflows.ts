import type { D1Database, Fetcher, KVNamespace, VectorizeIndex } from '@cloudflare/workers-types';
import { createRunId, errorFields, logger } from '../observability/logger.js';
import { coordinateEnrichment } from './enrichment.js';
import {
  resetGpaSync,
  resumeGpaSync,
} from './gpa-sync.js';
import { coordinateRmpSync } from './rmp-sync.js';
import { coordinateCourseSync } from './sync-coordinator.js';
import { discoverAndClassifyTerms } from './term-discovery.js';

type Env = {
  DB: D1Database;
  SELF: Fetcher;
  VECTORIZE: VectorizeIndex;
  GPA_CACHE: KVNamespace;
  CISAPI_BASE: string;
  SYNC_CONCURRENCY: string;
  INTERNAL_TOKEN?: string;
  RMP_AUTH_TOKEN?: string;
};

const schedules: Record<string, (env: Env, runId: string) => Promise<void>> = {
  '0 10,22 * * *': discoverTerms,
  '30 10,22 * * *': syncCourses,
  '0 8 * * SUN': weeklyEnrichment,
  '*/5 * * * *': resumeGpa,
};

export function dispatchScheduledWorkflows(input: {
  cron: string;
  env: Env;
  waitUntil: (workflow: Promise<void>) => void;
}): void {
  const run = schedules[input.cron];
  if (!run) return;
  const runId = createRunId('cron');
  input.waitUntil(run(input.env, runId).catch(error => {
    logger.error('cron.failed', { runId, cron: input.cron, ...errorFields(error) });
  }));
}

async function discoverTerms(env: Env): Promise<void> {
  await discoverAndClassifyTerms(env.DB, { cisapiBase: env.CISAPI_BASE });
}

async function syncCourses(env: Env, runId: string): Promise<void> {
  await coordinateCourseSync(env, {
    runId,
  });
}

async function weeklyEnrichment(env: Env): Promise<void> {
  try {
    await resetGpaSync(env.DB, env.GPA_CACHE);
  } catch (error) {
    logger.error('cron.gpaReset.failed', errorFields(error));
  }
  await coordinateRmpSync(env.DB, env.RMP_AUTH_TOKEN);
  await coordinateEnrichment(env.DB);
}

async function resumeGpa(env: Env): Promise<void> {
  await resumeGpaSync(env.DB, env.GPA_CACHE);
}
