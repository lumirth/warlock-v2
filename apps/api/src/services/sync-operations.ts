import type { D1Database, KVNamespace } from '@cloudflare/workers-types';

export type SyncRouteBindings = {
  DB: D1Database;
  GPA_CACHE: KVNamespace;

  CISAPI_BASE: string;

  SYNC_CONCURRENCY: string;
  RMP_AUTH_TOKEN?: string;
};

export function syncConcurrency(value: string): number {
  const concurrency = Number(value);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 50) {
    throw new Error('SYNC_CONCURRENCY must be an integer from 1 to 50');
  }
  return concurrency;
}
