import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import { feedbackRoutes } from '../feedback.js';

type FeedbackRouteBindings = {
  DB: D1Database;
};

function createApp(): Hono<{ Bindings: FeedbackRouteBindings }> {
  const app = new Hono<{ Bindings: FeedbackRouteBindings }>();
  app.route('/', feedbackRoutes);
  return app;
}

function createDb(run = vi.fn().mockResolvedValue({ success: true })) {
  const bind = vi.fn().mockReturnValue({ run });
  const prepare = vi.fn().mockReturnValue({ bind });

  return {
    db: { prepare } as unknown as D1Database,
    prepare,
    bind,
    run,
  };
}

describe('Feedback Routes', () => {
  it('stores structured feedback without requiring user identity', async () => {
    const { db, prepare, bind } = createDb();
    const app = createApp();

    const res = await app.request('/api/feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'vitest',
      },
      body: JSON.stringify({
        kind: 'search_results',
        issue: 'expected_different_results',
        page: 'search',
        query: 'professor fagen',
        expected: 'classes taught by Wade Fagen-Ulmschneider',
        metadata: { source: 'unit-test' },
      }),
    }, { DB: db });

    expect(res.status).toBe(202);
    await expect(res.json()).resolves.toMatchObject({
      status: 'accepted',
      received_at: expect.any(Number),
    });
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO feedback_events'));
    expect(bind).toHaveBeenCalledWith(
      expect.any(String),
      'search_results',
      'expected_different_results',
      'search',
      'professor fagen',
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      'classes taught by Wade Fagen-Ulmschneider',
      null,
      null,
      JSON.stringify({ source: 'unit-test' }),
      'vitest',
      expect.any(Number)
    );
  });

  it('rejects unsupported feedback kinds before writing', async () => {
    const { db, prepare } = createDb();
    const app = createApp();

    const res = await app.request('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'unsupported',
        issue: 'expected_different_results',
        page: 'search',
      }),
    }, { DB: db });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'kind is not supported' });
    expect(prepare).not.toHaveBeenCalled();
  });

  it('returns a stable public error if feedback storage fails', async () => {
    const { db } = createDb(vi.fn().mockRejectedValue(new Error('database unavailable')));
    const app = createApp();

    const res = await app.request('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'score',
        issue: 'wrong_score',
        page: 'course',
        subject: 'CS',
        number: '374',
      }),
    }, { DB: db });

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'feedback could not be saved' });
  });
});
