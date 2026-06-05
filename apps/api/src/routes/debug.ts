import { Hono } from 'hono';
import type { Ai, D1Database, KVNamespace, VectorizeIndex } from '@cloudflare/workers-types';
import { getUpstreamBackoff, resetUpstreamBackoff } from '../services/upstream-backoff.js';
import { parseSearchHttpRequest } from '../http/search-request.js';
import { SearchPipeline } from '../services/search-pipeline.js';
import { presentSearchDebugResponse } from '../services/search-debug-response-presenter.js';
import { errorFields, logger } from '../observability/logger.js';
import { parseSubjectsXml } from '../cisapi/parser.js';

type Bindings = {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  SEARCH_CACHE?: KVNamespace;
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

debugRoutes.get('/search-plan', async (c) => {
  const searchParams = new URL(c.req.url).searchParams;
  const parsedRequest = parseSearchHttpRequest(searchParams);
  if (!parsedRequest.ok) {
    return c.json({ error: parsedRequest.error }, 400);
  }

  const { request, pagination } = parsedRequest.value;

  try {
    const pipeline = new SearchPipeline(
      c.env.DB,
      c.env.VECTORIZE,
      c.env.AI,
      c.env.SEARCH_CACHE,
    );
    const result = await pipeline.search(
      request,
      pagination,
      c.executionCtx.waitUntil.bind(c.executionCtx),
    );
    return c.json(await presentSearchDebugResponse({
      db: c.env.DB,
      result,
      pagination,
    }));
  } catch (error) {
    logger.error('admin.debug.searchPlan.failed', { ...errorFields(error) });
    return c.json({ error: 'Search planner debug failed' }, 500);
  }
});

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
    const subjects = parseSubjectsXml(xml).map(subject => subject.id);

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
