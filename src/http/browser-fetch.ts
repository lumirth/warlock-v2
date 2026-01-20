/**
 * Browser-like fetch utility to bypass AWS WAF JavaScript challenges.
 *
 * AWS WAF on courses.illinois.edu triggers JS challenges for requests
 * that look like bots (missing User-Agent, Accept headers, etc.).
 * By mimicking a real browser's headers, we avoid the challenge.
 */

export const BROWSER_HEADERS: Record<string, string> = {
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

export interface BrowserFetchOptions extends RequestInit {
  retries?: number;
  retryDelay?: number;
}

/**
 * Fetch with browser-like headers to bypass WAF challenges.
 * Includes automatic retry logic for transient failures.
 */
export async function browserFetch(
  url: string,
  options: BrowserFetchOptions = {}
): Promise<Response> {
  const { retries = 3, retryDelay = 1000, ...fetchOptions } = options;
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
      const response = await fetch(url, {
        ...fetchOptions,
        headers
      });

      // Check for WAF challenge - retry if challenged
      if (isWafChallenge(response) && attempt < retries) {
        console.log(`WAF challenge on attempt ${attempt + 1} for ${url}, retrying...`);
        await sleep(retryDelay * (attempt + 1));
        continue;
      }

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < retries) {
        console.log(`Fetch error on attempt ${attempt + 1} for ${url}: ${lastError.message}, retrying...`);
        await sleep(retryDelay * (attempt + 1));
        continue;
      }
    }
  }

  throw lastError || new Error(`Failed to fetch ${url} after ${retries + 1} attempts`);
}

/**
 * Check if a response indicates a WAF challenge.
 */
export function isWafChallenge(response: Response): boolean {
  const wafAction = response.headers.get('x-amzn-waf-action');
  return wafAction === 'challenge' || wafAction === 'captcha';
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
