import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Ai, D1Database, Fetcher, KVNamespace, VectorizeIndex } from '@cloudflare/workers-types';
import { syncRoutes } from '../sync.js';

function createDb(): D1Database {
  return {
    prepare: vi.fn((sql: string) => ({
      all: vi.fn(async () => {
        if (sql.includes('FROM sync_state')) {
          return {
            success: true,
            results: [
              { id: 'course-sync:2026-spring:CS', last_sync: 1, last_status: 'running', items_synced: 0, cursor: 0, etag: null },
              { id: 'rmp', last_sync: 2, last_status: 'failed', items_synced: 20, cursor: 1, etag: 'cursor' },
            ],
          };
        }
        if (sql.includes('FROM term_state')) {
          return {
            success: true,
            results: [
              {
                term_id: '2026-spring',
                year: 2026,
                term: 'spring',
                status: 'active',
                last_checked: 1,
                last_synced: 2,
                subjects_count: 1,
                courses_count: 2,
                sections_count: 3,
                sync_errors: null,
                created_at: 1,
                updated_at: 2,
              },
            ],
          };
        }
        return { success: true, results: [] };
      }),
    })),
  } as unknown as D1Database;
}

describe('sync status route', () => {
  it('reports sync_state and term_state health for admin operators', async () => {
    const app = new Hono<{
      Bindings: {
        DB: D1Database;
        VECTORIZE: VectorizeIndex;
        AI: Ai;
        SELF: Fetcher;
        GPA_CACHE: KVNamespace;
        CURRENT_YEAR: string;
        CURRENT_TERM: string;
        CISAPI_BASE: string;
        FRONTEND_BASE: string;
        SYNC_CONCURRENCY: string;
      };
    }>();
    app.route('/', syncRoutes);

    const response = await app.request('/admin/sync/status', {}, {
      DB: createDb(),
      VECTORIZE: {} as VectorizeIndex,
      AI: {} as Ai,
      SELF: {} as Fetcher,
      GPA_CACHE: {} as KVNamespace,
      CURRENT_YEAR: '2026',
      CURRENT_TERM: 'spring',
      CISAPI_BASE: 'https://example.invalid',
      FRONTEND_BASE: 'https://example.invalid',
      SYNC_CONCURRENCY: '1',
    });

    expect(response.status).toBe(200);
    const data = await response.json() as {
      syncStates: Array<{ id: string; last_status: string }>;
      termStates: Array<{ term_id: string; status: string }>;
      unhealthySyncStates: Array<{ id: string }>;
      runningSyncStates: Array<{ id: string }>;
    };

    expect(data.syncStates).toHaveLength(2);
    expect(data.termStates).toEqual([expect.objectContaining({ term_id: '2026-spring', status: 'active' })]);
    expect(data.unhealthySyncStates).toEqual([expect.objectContaining({ id: 'rmp' })]);
    expect(data.runningSyncStates).toEqual([expect.objectContaining({ id: 'course-sync:2026-spring:CS' })]);
  });
});
