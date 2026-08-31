import { errorFields, logger } from '../observability/logger.js';

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 AppleWebKit/537.36 Chrome/121 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://courses.illinois.edu/',
  'Cache-Control': 'no-cache',
};

interface BrowserFetchOptions extends RequestInit {
  retries?: number;
  retryDelay?: number;
  timeoutMs?: number;
}

export async function browserFetch(
  url: string,
  { retries = 3, retryDelay = 1_000, timeoutMs, ...options }: BrowserFetchOptions = {},
): Promise<Response> {
  const headers = new Headers(BROWSER_HEADERS);
  new Headers(options.headers).forEach((value, key) => headers.set(key, value));
  let failure = new Error(`failed to fetch ${url}`);

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: requestSignal(options.signal, timeoutMs),
      });
      if (!isChallenge(response)) return response;
      await response.body?.cancel();
      failure = new Error(`WAF challenge persisted for ${url} after ${retries + 1} attempts`);
    } catch (error) {
      if (aborted(options.signal)) throw error;
      failure = asError(error);
    }
    if (attempt < retries) {
      logger.warn('browserFetch.retry', { attempt: attempt + 1, ...errorFields(failure) });
      await delay(retryDelay * (attempt + 1), options.signal);
    }
  }
  throw failure;
}

function aborted(signal: AbortSignal | null | undefined): boolean {
  return signal?.aborted === true;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function requestSignal(signal: AbortSignal | null | undefined, timeoutMs?: number): AbortSignal | undefined {
  if (!timeoutMs) return signal ?? undefined;
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function isChallenge(response: Response): boolean {
  const action = response.headers.get('x-amzn-waf-action');
  return action === 'challenge' || action === 'captcha';
}

function delay(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const done = () => { signal?.removeEventListener('abort', aborted); resolve(); };
    const timer = setTimeout(done, ms);
    const aborted = () => { clearTimeout(timer); reject(signal?.reason); };
    signal?.addEventListener('abort', aborted, { once: true });
  });
}
