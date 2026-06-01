import { Hono } from 'hono';
import { getUpstreamBackoff, resetUpstreamBackoff } from '../services/upstream-backoff.js';

type Bindings = {
  CISAPI_BASE: string;
  BACKOFF_BASE_MS: string;
  BACKOFF_MAX_MS: string;
  MAX_RETRIES: string;
  CURRENT_YEAR: string;
  CURRENT_TERM: string;
};

// Admin routes mounted at /
export const adminRoutes = new Hono<{ Bindings: Bindings }>();

adminRoutes.get('/admin/upstream-backoff-status', (c) => {
  const upstreamBackoff = getUpstreamBackoff({
    backoffBaseMs: parseInt(c.env.BACKOFF_BASE_MS) || 5000,
    backoffMaxMs: parseInt(c.env.BACKOFF_MAX_MS) || 60000,
    maxRetries: parseInt(c.env.MAX_RETRIES) || 3,
  });

  const state = upstreamBackoff.getState();
  const errorMessage = upstreamBackoff.getErrorMessage();
  const staleWarning = upstreamBackoff.getStaleDataWarning();

  return c.json({
    ...state,
    errorMessage,
    staleWarning,
  });
});

adminRoutes.post('/admin/reset-upstream-backoff', (c) => {
  resetUpstreamBackoff();
  return c.json({ message: 'Upstream backoff reset' });
});

// Debug routes mounted at /admin/debug
export const debugRoutes = new Hono<{ Bindings: Bindings }>();

debugRoutes.get('/subjects/:year/:term', async (c) => {
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
