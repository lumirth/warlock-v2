import { Hono } from 'hono';
import type { Ai, D1Database, KVNamespace, VectorizeIndex } from '@cloudflare/workers-types';
import { SEARCH_TERM_VALUES } from '@uiuc-course-search/query-types';
import { getUpstreamBackoff, resetUpstreamBackoff } from '../services/upstream-backoff.js';
import { parseSearchHttpRequest } from '../http/search-request.js';
import { parseBoundedIntParam, parseEnumParam } from '../http/params.js';
import { SearchPipeline } from '../services/search-pipeline.js';
import { presentSearchDebugResponse } from '../services/search-debug-response-presenter.js';
import { errorFields, logger } from '../observability/logger.js';
import { inspectSubjectList } from '../services/subject-list-diagnostic.js';

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
  const parsedYear = parseBoundedIntParam(year, 'year', {
    min: 2004,
    max: new Date().getFullYear() + 5,
  });
  if (!parsedYear.ok) return c.json({ error: parsedYear.error }, 400);

  const parsedTerm = parseEnumParam(term.toLowerCase(), 'term', SEARCH_TERM_VALUES);
  if (!parsedTerm.ok) return c.json({ error: parsedTerm.error }, 400);

  const url = `${c.env.CISAPI_BASE}/schedule/${parsedYear.value}/${parsedTerm.value}.xml`;

  try {
    const diagnostic = await inspectSubjectList(url);
    return diagnostic.ok
      ? c.json(diagnostic)
      : c.json({ error: `HTTP ${diagnostic.status}`, ...diagnostic });
  } catch (error) {
    return c.json({ error: String(error), url });
  }
});
