import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { debugRoutes } from '../debug.js';

describe('debug routes', () => {
  it('does not expose arbitrary server-side fetch diagnostics', async () => {
    const app = new Hono();
    app.route('/admin/debug', debugRoutes);

    const res = await app.request('/admin/debug/fetch?url=https://example.com');

    expect(res.status).toBe(404);
  });
});
