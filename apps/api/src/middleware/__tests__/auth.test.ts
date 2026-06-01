import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { internalAuthHeaders, requireBearerToken } from '../auth.js';

type TestBindings = {
  ADMIN_TOKEN?: string;
  INTERNAL_TOKEN?: string;
};

function makeApp() {
  const app = new Hono<{ Bindings: TestBindings }>();

  app.use('/admin/*', requireBearerToken('ADMIN_TOKEN'));
  app.use('/internal/*', requireBearerToken('INTERNAL_TOKEN'));

  app.get('/admin/status', (c) => c.json({ ok: true, scope: 'admin' }));
  app.post('/internal/task', (c) => c.json({ ok: true, scope: 'internal' }));

  return app;
}

describe('auth middleware', () => {
  it('rejects unauthenticated admin requests before route logic runs', async () => {
    const res = await makeApp().request('/admin/status', {}, { ADMIN_TOKEN: 'secret' });

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  it('rejects admin requests with the wrong token', async () => {
    const res = await makeApp().request(
      '/admin/status',
      { headers: { Authorization: 'Bearer wrong' } },
      { ADMIN_TOKEN: 'secret' }
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'Forbidden' });
  });

  it('rejects configured-token requests when the expected binding is missing', async () => {
    const res = await makeApp().request(
      '/admin/status',
      { headers: { Authorization: 'Bearer secret' } },
      {}
    );

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: 'ADMIN_TOKEN is not configured' });
  });

  it('allows admin requests with the configured token', async () => {
    const res = await makeApp().request(
      '/admin/status',
      { headers: { Authorization: 'Bearer secret' } },
      { ADMIN_TOKEN: 'secret' }
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, scope: 'admin' });
  });

  it('protects internal requests separately from admin requests', async () => {
    const unauthorized = await makeApp().request(
      '/internal/task',
      { method: 'POST', headers: { Authorization: 'Bearer admin-secret' } },
      { ADMIN_TOKEN: 'admin-secret', INTERNAL_TOKEN: 'internal-secret' }
    );
    expect(unauthorized.status).toBe(403);

    const authorized = await makeApp().request(
      '/internal/task',
      { method: 'POST', headers: internalAuthHeaders('internal-secret') },
      { ADMIN_TOKEN: 'admin-secret', INTERNAL_TOKEN: 'internal-secret' }
    );
    expect(authorized.status).toBe(200);
    await expect(authorized.json()).resolves.toEqual({ ok: true, scope: 'internal' });
  });
});
