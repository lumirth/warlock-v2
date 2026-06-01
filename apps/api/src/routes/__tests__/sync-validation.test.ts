import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { syncRoutes } from '../sync.js';

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
    await expect(res.json()).resolves.toEqual({ error: 'limit must be between 1 and 40' });
  });
});
