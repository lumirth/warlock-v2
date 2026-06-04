import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserFetch } from '../browser-fetch.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('browserFetch', () => {
  it('rejects when WAF challenge responses persist through the final retry', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response('<html>challenge</html>', {
        status: 202,
        headers: { 'x-amzn-waf-action': 'challenge' },
      })
    );

    await expect(browserFetch('https://courses.example.test', {
      retries: 1,
      retryDelay: 0,
    })).rejects.toThrow('WAF challenge persisted');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
