import { describe, expect, it, vi } from 'vitest';
import {
  fetchWithRateLimitRetry,
  requestDelayForBaseUrl,
} from '../runner.js';

describe('eval runner request pacing', () => {
  it('keeps local eval runs unthrottled', () => {
    expect(requestDelayForBaseUrl('http://localhost:8787')).toBe(0);
    expect(requestDelayForBaseUrl('http://127.0.0.1:8787')).toBe(0);
    expect(requestDelayForBaseUrl('http://[::1]:8787')).toBe(0);
  });

  it('paces remote eval runs to avoid API rate limits', () => {
    expect(
      requestDelayForBaseUrl(
        'https://uiuc-course-search-staging.lumirth.workers.dev'
      )
    ).toBeGreaterThan(0);
  });

  it('retries 429 responses after Retry-After before returning success', async () => {
    const fetcher = vi
      .fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        new Response('rate limited', {
          status: 429,
          headers: { 'Retry-After': '2' },
        })
      )
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    const sleeper = vi.fn(async () => undefined);

    const response = await fetchWithRateLimitRetry('https://example.test', {
      fetcher,
      sleeper,
      maxRetries: 1,
    });

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleeper).toHaveBeenCalledWith(2000);
  });

  it('passes request init through retries', async () => {
    const fetcher = vi
      .fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    const init: RequestInit = {
      headers: { Authorization: 'Bearer test-token' },
    };

    await fetchWithRateLimitRetry('https://example.test', {
      fetcher,
      init,
      maxRetries: 0,
    });

    expect(fetcher).toHaveBeenCalledWith('https://example.test', init);
  });
});
