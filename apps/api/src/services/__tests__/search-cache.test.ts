import { describe, expect, it } from 'vitest';
import type { KVNamespace } from '@cloudflare/workers-types';
import {
  cacheSearchPlan,
  cacheSearchResult,
  getCachedSearchPlan,
  getCachedSearchResult,
  searchPlanCacheKey,
  searchResultCacheKey,
} from '../search-cache.js';
import { normalizeSearchRequest } from '../search-request.js';
import type { RetrievalPlan } from '../search-retrieval-plan.js';
import type { SearchPipelineResult } from '../search-response.js';

function memoryKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
  } as unknown as KVNamespace;
}

describe('search cache', () => {
  it('normalizes query text and stable override order in plan keys', () => {
    const left = normalizeSearchRequest({
      query: ' Easy   Online Gen Ed ',
      filters: { credits: 3, online: true },
    });
    const right = normalizeSearchRequest({
      query: 'easy online gen ed',
      filters: { online: true, credits: 3 },
    });

    expect(searchPlanCacheKey(left)).toBe(
      searchPlanCacheKey(right)
    );
  });

  it('keys canonical requests by normalized query, filters, sort, and scope', () => {
    const left = normalizeSearchRequest({
      query: ' Easy   Online Gen Ed ',
      filters: { credits: 3, online: true },
      sort: { field: 'gpa', direction: 'desc' },
      scope: 'all',
    });
    const right = normalizeSearchRequest({
      query: 'easy online gen ed',
      filters: { online: true, credits: 3 },
      sort: { field: 'gpa', direction: 'desc' },
      scope: 'all',
    });
    const differentSort = normalizeSearchRequest({
      query: 'easy online gen ed',
      filters: { online: true, credits: 3 },
      sort: { field: 'quality', direction: 'desc' },
      scope: 'all',
    });

    expect(searchPlanCacheKey(left)).toBe(searchPlanCacheKey(right));
    expect(searchResultCacheKey(left, 20)).toBe(searchResultCacheKey(right, 20));
    expect(searchResultCacheKey(left, 20)).not.toBe(
      searchResultCacheKey(differentSort, 20),
    );
  });

  it('round-trips cached plans and result payloads through KV JSON', async () => {
    const kv = memoryKv();
    const planning = {
      extraction: { hints: [], residual: '' },
      queryResidual: '',
      plan: {
        filters: { online: true },
        keywordQuery: '',
        semanticQuery: '',
      },
    };
    const retrievalPlan: RetrievalPlan = {
      inputPlan: planning.plan,
      effectivePlan: planning.plan,
      controls: { sort: { field: 'relevance', direction: 'desc' }, scope: 'active' },
      budget: {
        pageLimit: 20,
        pageOffset: 0,
        requestedWindow: 21,
        resultWindowLimit: 40,
        executionResultLimit: 40,
        termCandidateLimit: 80,
        laneCandidateLimit: 80,
        maxResultWindow: 1200,
        reasons: ['relevance_page_window'],
      },
      isNavigational: false,
      hasKeywordQuery: false,
      hasSemanticQuery: false,
      lanes: [],
      aliasQuery: '',
      workloadSignalTypes: [],
    };
    const result = {
      results: [],
      meta: {
        query: { raw: 'easy online gen ed', residual: '' },
        extraction: { hints: [] },
        plan: planning.plan,
        retrievalPlan,
        retrievalPlans: [retrievalPlan],
        budget: {
          pageLimit: 20,
          pageOffset: 0,
          requestedWindow: 21,
          resultWindowLimit: 40,
          executionResultLimit: 40,
          termCandidateLimit: 80,
          laneCandidateLimit: 80,
          maxResultWindow: 1200,
          reasons: ['relevance_page_window'],
        },
        timing: { extraction_ms: 1, search_ms: 1, total_ms: 2 },
        fallback: { tierReached: 2, constraintsRelaxed: [], originalResultCount: 0 },
      },
    } satisfies SearchPipelineResult;
    const request = normalizeSearchRequest({
      query: 'easy online gen ed',
      filters: { online: true },
    });

    await cacheSearchPlan(kv, request, planning);
    await cacheSearchResult(kv, request, 20, result);

    await expect(getCachedSearchPlan(kv, request)).resolves.toEqual(planning);
    await expect(getCachedSearchResult(kv, request, 20)).resolves.toEqual(result);
  });
});
