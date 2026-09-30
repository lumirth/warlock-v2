import type { D1Database } from '@cloudflare/workers-types';
import { FEEDBACK_BODY_MAX_BYTES } from '@warlock-v2/query-types';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { feedbackRoutes } from '../feedback.js';

function fixture(run = vi.fn().mockResolvedValue({ success: true })) {
  const bind = vi.fn().mockReturnValue({ run });
  const prepare = vi.fn().mockReturnValue({ bind });
  const app = new Hono<{ Bindings: { DB: D1Database } }>();
  app.route('/', feedbackRoutes);
  return { app, env: { DB: { prepare } as unknown as D1Database }, prepare, bind };
}

const valid = {
  page: 'search',
  query: 'professor fagen', expected: 'classes taught by Fagen',
  metadata: { source: 'unit-test' },
};

describe('feedback HTTP boundary', () => {
  it('stores an anonymous, decoded event', async () => {
    const { app, env, bind } = fixture();
    const response = await app.request('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'vitest' },
      body: JSON.stringify(valid),
    }, env);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ status: 'accepted' });
    expect(bind).toHaveBeenCalledWith(
      expect.any(String), 'search', 'professor fagen', null, null, null, null, null,
      'classes taught by Fagen', null, JSON.stringify({ source: 'unit-test' }),
      'vitest', expect.any(Number),
    );
  });

  it.each([
    ['text/plain', 'not json', 415],
    ['application/json', '{', 400],
    ['application/json', JSON.stringify({ ...valid, page: 'unsupported' }), 400],
  ])('rejects unsafe %s input before storage', async (contentType, body, status) => {
    const { app, env, prepare } = fixture();
    const response = await app.request('/api/feedback', {
      method: 'POST', headers: { 'Content-Type': contentType }, body,
    }, env);
    expect(response.status).toBe(status);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('bounds the body before JSON decoding', async () => {
    const { app, env, prepare } = fixture();
    const response = await app.request('/api/feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...valid, message: 'x'.repeat(FEEDBACK_BODY_MAX_BYTES) }),
    }, env);
    expect(response.status).toBe(413);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('does not expose a storage failure', async () => {
    const { app, env } = fixture(vi.fn().mockRejectedValue(new Error('secret')));
    const response = await app.request('/api/feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(valid),
    }, env);
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'feedback could not be saved' });
  });
});
