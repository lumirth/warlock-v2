import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { syncRoutes } from '../sync.js';
import {
  readTermAggregateCounts,
  resolveManualSyncTermStatus,
} from '../../services/sync-operations.js';
import type { D1Database } from '@cloudflare/workers-types';

describe('sync route validation', () => {
  it('rejects invalid admin sync path params', async () => {
    const app = new Hono();
    app.route('/', syncRoutes);

    const res = await app.request('/admin/sync/not-a-year/nope', { method: 'POST' });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'year must be an integer' });
  });

  it('caps admin sync batch limits', async () => {
    const app = new Hono();
    app.route('/', syncRoutes);

    const res = await app.request('/admin/sync/2026/spring?limit=999999', { method: 'POST' });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'limit must be between 1 and 20' });
  });

  it('rejects invalid manual sync status overrides', async () => {
    const app = new Hono();
    app.route('/', syncRoutes);

    const res = await app.request('/admin/sync/2026/spring?status=archived', { method: 'POST' });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'status must be one of: registrable, active, historical' });
  });

  it('rejects invalid manual sync force flags', async () => {
    const app = new Hono();
    app.route('/', syncRoutes);

    const res = await app.request('/admin/sync/2026/spring?force=yes', { method: 'POST' });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'force must be true or false' });
  });

  it('resolves manual sync status without turning historical backfills into active terms', () => {
    expect(resolveManualSyncTermStatus(null)).toBe('active');
    expect(resolveManualSyncTermStatus({ status: 'active' })).toBe('active');
    expect(resolveManualSyncTermStatus({ status: 'registrable' })).toBe('registrable');
    expect(resolveManualSyncTermStatus({ status: 'historical' })).toBe('historical');
    expect(resolveManualSyncTermStatus({ status: 'active' }, 'historical')).toBe('historical');
    expect(resolveManualSyncTermStatus({ status: 'historical' }, 'registrable')).toBe('registrable');
  });

  it('reads cumulative term counts instead of trusting the current sync page', async () => {
    const db = {
      prepare: (sql: string) => ({
        bind: (...params: unknown[]) => ({
          first: async () => {
            if (sql.includes('FROM courses')) {
              expect(params).toEqual([2026, 'spring']);
              return { count: 4494 };
            }
            if (sql.includes('FROM sections')) {
              expect(params).toEqual(['2026-spring']);
              return { count: 11960 };
            }
            return { count: 0 };
          },
        }),
      }),
    } as unknown as D1Database;

    await expect(readTermAggregateCounts(db, '2026-spring', 2026, 'spring', 187)).resolves.toEqual({
      subjectsCount: 187,
      coursesCount: 4494,
      sectionsCount: 11960,
    });
  });
});
