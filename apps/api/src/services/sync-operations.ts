import type { D1Database, KVNamespace } from '@cloudflare/workers-types';

export type SyncRouteBindings = {
  DB: D1Database;
  GPA_CACHE: KVNamespace;

  CISAPI_BASE: string;
  RMP_AUTH_TOKEN?: string;
};
