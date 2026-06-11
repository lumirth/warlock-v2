import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { adminRoutes, debugRoutes } from '../debug.js';

const debugEnv = {
  CISAPI_BASE: 'https://example.invalid',
  BACKOFF_BASE_MS: '5000',
  BACKOFF_MAX_MS: '60000',
  MAX_RETRIES: '3',
  CURRENT_YEAR: '2026',
  CURRENT_TERM: 'spring',
};

describe('debug routes', () => {
  it('does not expose arbitrary server-side fetch diagnostics', async () => {
    const app = new Hono();
    app.route('/admin/debug', debugRoutes);

    const res = await app.request('/admin/debug/fetch?url=https://example.com');

    expect(res.status).toBe(404);
  });

  it('does not expose raw instructor-linking diagnostics', async () => {
    const app = new Hono();
    app.route('/admin/debug', debugRoutes);

    const res = await app.request('/admin/debug/link-instructor?subject=ALEC&number=115');

    expect(res.status).toBe(404);
  });

  it('keeps the subject-list diagnostic constrained to valid term paths', async () => {
    const app = new Hono();
    app.route('/admin/debug', debugRoutes);

    const invalidYear = await app.request('/admin/debug/subjects/nope/fall', {}, debugEnv);
    const invalidTerm = await app.request('/admin/debug/subjects/2026/nope', {}, debugEnv);

    expect(invalidYear.status).toBe(400);
    expect(invalidTerm.status).toBe(400);
  });

  it('does not keep legacy admin sync aliases mounted', async () => {
    const app = new Hono();
    app.route('/', adminRoutes);

    const rmpAlias = await app.request('/admin/sync/rmp', { method: 'POST' }, debugEnv);
    const enrichAlias = await app.request('/admin/sync/enrich', { method: 'POST' }, debugEnv);

    expect(rmpAlias.status).toBe(404);
    expect(enrichAlias.status).toBe(404);
  });

  it('keeps the fixed upstream backoff diagnostic available', async () => {
    const app = new Hono();
    app.route('/', adminRoutes);

    const res = await app.request('/admin/upstream-backoff-status', {}, debugEnv);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(expect.objectContaining({
      consecutiveFailures: expect.any(Number),
      isBackingOff: expect.any(Boolean),
    }));
  });
});
