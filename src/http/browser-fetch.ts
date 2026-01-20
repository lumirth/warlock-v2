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

/**
 * Fetch with browser-like headers to bypass WAF challenges.
 */
export async function browserFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);

  // Add browser headers if not already set
  for (const [key, value] of Object.entries(BROWSER_HEADERS)) {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  }

  return fetch(url, {
    ...options,
    headers
  });
}

/**
 * Check if a response indicates a WAF challenge.
 */
export function isWafChallenge(response: Response): boolean {
  const wafAction = response.headers.get('x-amzn-waf-action');
  return wafAction === 'challenge' || wafAction === 'captcha';
}
