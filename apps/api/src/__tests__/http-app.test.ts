import { describe, expect, it, vi } from 'vitest';
import { app, isAllowedFeedbackOrigin, type Bindings } from '../http-app.js';

const TOKENS = {
  ADMIN_TOKEN: 'admin-secret',
  INTERNAL_TOKEN: 'internal-secret',
} as Bindings;

function protectedRoutes(prefix: '/admin/' | '/internal/') {
  return app.routes.filter(route =>
    route.method !== 'ALL' && route.path.startsWith(prefix)
  );
}

describe('actual application security boundaries', () => {
  it.each([
    ['/admin/', 'admin-secret'],
    ['/internal/', 'internal-secret'],
  ] as const)('protects every mounted %s route', async (prefix, validToken) => {
    const routes = protectedRoutes(prefix);
    expect(routes.length).toBeGreaterThan(0);

    for (const route of routes) {
      const missing = await app.request(route.path, { method: route.method }, TOKENS);
      expect(missing.status, `${route.method} ${route.path} without token`).toBe(401);

      const wrong = await app.request(route.path, {
        method: route.method,
        headers: { Authorization: `Bearer wrong-${validToken}` },
      }, TOKENS);
      expect(wrong.status, `${route.method} ${route.path} with wrong token`).toBe(403);
    }
  });

  it('fails closed when the configured token is absent', async () => {
    const response = await app.request('/admin/sync/status', {
      headers: { Authorization: 'Bearer admin-secret' },
    }, {} as Bindings);

    expect(response.status).toBe(503);
  });

  it('enforces public rate limits before route work', async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const response = await app.request('/api/search?q=CS', {}, {
      SEARCH_RATE_LIMITER: { limit },
    } as unknown as Bindings);

    expect(response.status).toBe(429);
    expect(limit).toHaveBeenCalledOnce();
  });

  it('allows only exact configured feedback origins', async () => {
    const configured = 'https://uiuc-course-search-web.pages.dev';
    expect(isAllowedFeedbackOrigin(configured, configured)).toBe(true);
    expect(isAllowedFeedbackOrigin(`${configured}.evil.example`, configured)).toBe(false);
    expect(isAllowedFeedbackOrigin(undefined, configured)).toBe(false);

    const response = await app.request('/api/feedback', {
      method: 'POST',
      headers: { Origin: `${configured}.evil.example` },
    }, { FEEDBACK_ALLOWED_ORIGINS: configured } as Bindings);
    expect(response.status).toBe(403);
  });
});
