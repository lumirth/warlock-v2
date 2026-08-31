import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { healthRoutes } from '../health.js';

const healthEnv = {
  DB: {
    prepare: () => ({ first: async () => ({ term: 'spring', year: 2026 }) }),
  },
};

describe('health routes', () => {
  it('serves the intentionally public health endpoints', async () => {
    const app = new Hono();
    app.route('/', healthRoutes);

    const root = await app.request('/', {}, healthEnv);
    const health = await app.request('/health', {}, healthEnv);

    expect(root.status).toBe(200);
    await expect(root.json()).resolves.toEqual({
      status: 'ok',
      message: 'UIUC Course Search API',
      term: 'spring 2026',
    });

    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ healthy: true });
  });

  it('does not expose public database-count diagnostics', async () => {
    const app = new Hono();
    app.route('/', healthRoutes);

    const stats = await app.request('/stats', {}, healthEnv);
    const dataHealth = await app.request('/health/data', {}, healthEnv);

    expect(stats.status).toBe(404);
    expect(dataHealth.status).toBe(404);
  });
});
