import { Hono } from 'hono';
import { getRateLimiter, resetRateLimiter } from '../services/rate-limiter.js';
import { browserFetch } from '../http/browser-fetch.js';

type Bindings = {
  // API endpoints
  CISAPI_BASE: string;

  // Rate limiting
  BACKOFF_BASE_MS: string;
  BACKOFF_MAX_MS: string;
  MAX_RETRIES: string;
};

export const debugRoutes = new Hono<{ Bindings: Bindings }>();

// Rate limiter status
debugRoutes.get('/admin/rate-limit-status', (c) => {
  const rateLimiter = getRateLimiter({
    backoffBaseMs: parseInt(c.env.BACKOFF_BASE_MS) || 5000,
    backoffMaxMs: parseInt(c.env.BACKOFF_MAX_MS) || 60000,
    maxRetries: parseInt(c.env.MAX_RETRIES) || 3,
  });

  const state = rateLimiter.getState();
  const errorMessage = rateLimiter.getErrorMessage();
  const staleWarning = rateLimiter.getStaleDataWarning();

  return c.json({
    ...state,
    errorMessage,
    staleWarning,
  });
});

// Debug endpoint - test fetching any CISAPI URL
debugRoutes.get('/admin/debug/fetch', async (c) => {
  const testUrl = c.req.query('url');
  const useBrowserHeaders = c.req.query('browser') !== 'false';

  if (!testUrl) {
    return c.json({ error: 'Missing ?url= parameter' });
  }

  try {
    const response = useBrowserHeaders
      ? await browserFetch(testUrl)
      : await fetch(testUrl, { headers: { 'Accept': 'application/xml' } });

    const respHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      respHeaders[key] = value;
    });

    const body = await response.text();

    return c.json({
      url: testUrl,
      status: response.status,
      statusText: response.statusText,
      bodyLength: body.length,
      bodySnippet: body.substring(0, 1000),
      headers: respHeaders,
      usedBrowserHeaders: useBrowserHeaders
    });
  } catch (error) {
    return c.json({ error: String(error), url: testUrl });
  }
});

// Debug endpoint - test fetching subjects
debugRoutes.get('/admin/debug/subjects/:year/:term', async (c) => {
  const { year, term } = c.req.param();
  const url = `${c.env.CISAPI_BASE}/schedule/${year}/${term}.xml`;

  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/xml' },
      redirect: 'follow'
    });

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    if (!response.ok) {
      return c.json({
        error: `HTTP ${response.status}`,
        url,
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }

    const xml = await response.text();
    const subjectRegex = /<subject id="([^"]+)"/g;
    const subjects: string[] = [];
    let match;

    while ((match = subjectRegex.exec(xml)) !== null) {
      subjects.push(match[1]);
    }

    return c.json({
      url,
      status: response.status,
      subjectCount: subjects.length,
      subjects: subjects.slice(0, 10),
      xmlLength: xml.length,
      xmlSnippet: xml.substring(0, 500),
      headers
    });
  } catch (error) {
    return c.json({ error: String(error), url });
  }
});

// Reset rate limiter
debugRoutes.post('/admin/reset-rate-limiter', (c) => {
  resetRateLimiter();
  return c.json({ message: 'Rate limiter reset' });
});
