import { describe, expect, it, vi } from 'vitest';
import { evalRequestUrl, fetchWithRateLimitRetry } from '../runner.js';

describe('public eval requests', () => {
  it('targets only the public contract and safely encodes queries', () => {
    expect(evalRequestUrl('https://example.test/', "what's easy"))
      .toBe('https://example.test/api/search?q=what%27s%20easy&limit=20');
  });

  it('honors Retry-After once before succeeding', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('', {
        status: 429,
        headers: { 'Retry-After': '2' },
      }))
      .mockResolvedValueOnce(new Response('{}'));
    const sleeper = vi.fn(async () => undefined);

    const response = await fetchWithRateLimitRetry('https://example.test', {
      fetcher,
      sleeper,
      retries: 1,
    });

    expect(response.status).toBe(200);
    expect(sleeper).toHaveBeenCalledWith(2_000);
  });
});
