import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { courseRoutes } from '../course.js';

function app() {
  const hono = new Hono();
  hono.route('/', courseRoutes);
  return hono;
}

describe('course routes', () => {
  it('rejects malformed subject and course number params', async () => {
    const res = await app().request('/api/course/too-long/not-a-number', {}, {
      CURRENT_YEAR: '2026',
      CURRENT_TERM: 'spring',
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'subject must be a 2-4 letter subject code' });
  });

  it('requires year and term query params to be provided together', async () => {
    const res = await app().request('/api/course/CS/225?year=2026', {}, {
      CURRENT_YEAR: '2026',
      CURRENT_TERM: 'spring',
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'year and term must be provided together' });
  });
});
