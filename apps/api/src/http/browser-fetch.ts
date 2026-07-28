import { errorFields, logger } from '../observability/logger.js';

/**
 * Browser-like fetch utility to bypass AWS WAF JavaScript challenges.
 *
 * AWS WAF on courses.illinois.edu triggers JS challenges for requests
 * that look like bots (missing User-Agent, Accept headers, etc.).
 * By mimicking a real browser's headers, we avoid the challenge.
 */

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'same-origin',
  'Referer': 'https://courses.illinois.edu/',
  'Pragma': 'no-cache',
  'Cache-Control': 'no-cache'
};

interface BrowserFetchOptions extends RequestInit {
  retries?: number;
  retryDelay?: number;
  timeoutMs?: number;
}

/**
 * Fetch with browser-like headers to bypass WAF challenges.
 * Includes automatic retry logic for transient failures.
 */
export async function browserFetch(
  url: string,
  options: BrowserFetchOptions = {}
): Promise<Response> {
  const { retries = 3, retryDelay = 1000, timeoutMs, ...fetchOptions } = options;
  const headers = new Headers(fetchOptions.headers);

  // Add browser headers if not already set
  for (const [key, value] of Object.entries(BROWSER_HEADERS)) {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, fetchOptions, headers, timeoutMs);

      // Check for WAF challenge - retry if challenged
      if (isWafChallenge(response)) {
        response.body?.cancel().catch(() => undefined);
        if (attempt < retries) {
          logger.warn('browserFetch.wafChallenge', { attempt: attempt + 1 });
          await sleep(retryDelay * (attempt + 1));
          continue;
        }
        throw new Error(`WAF challenge persisted for ${url} after ${retries + 1} attempts`);
      }

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (fetchOptions.signal?.aborted) {
        break;
      }

      if (attempt < retries) {
        logger.warn('browserFetch.retryableFailure', { attempt: attempt + 1, ...errorFields(lastError) });
        await sleep(retryDelay * (attempt + 1), fetchOptions.signal);
        continue;
      }
    }
  }

  throw lastError || new Error(`Failed to fetch ${url} after ${retries + 1} attempts`);
}

/**
 * Check if a response indicates a WAF challenge.
 */
function isWafChallenge(response: Response): boolean {
  const wafAction = response.headers.get('x-amzn-waf-action');
  return wafAction === 'challenge' || wafAction === 'captcha';
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(abortError(signal.reason));
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(abortError(signal?.reason));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function abortError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason ?? 'Fetch aborted'));
}

function fetchWithTimeout(
  url: string,
  options: RequestInit,
  headers: Headers,
  timeoutMs: number | undefined
): Promise<Response> {
  if (!timeoutMs) {
    return fetch(url, {
      ...options,
      headers
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(`fetch timed out after ${timeoutMs}ms`);
  }, timeoutMs);

  const upstreamSignal = options.signal;
  const abortFromUpstream = () => {
    controller.abort(upstreamSignal?.reason);
  };

  if (upstreamSignal?.aborted) {
    abortFromUpstream();
  } else {
    upstreamSignal?.addEventListener('abort', abortFromUpstream, { once: true });
  }

  return fetch(url, {
    ...options,
    headers,
    signal: controller.signal,
  }).finally(() => {
    clearTimeout(timeout);
    upstreamSignal?.removeEventListener('abort', abortFromUpstream);
  });
}
