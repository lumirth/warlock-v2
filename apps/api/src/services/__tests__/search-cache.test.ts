import { describe, expect, it } from 'vitest';
import type { KVNamespace } from '@cloudflare/workers-types';
import { normalizeSearchRequestDto } from '@uiuc-course-search/query-types';
import {
  cacheSearchPlan,
  cacheSearchResult,
  getCachedSearchPlan,
  getCachedSearchResult,
  searchPlanCacheKey,
  searchResultCacheKey,
} from '../search-cache.js';
import type { RetrievalPlan } from '../search-retrieval-plan.js';
import type { SearchPipelineResult } from '../search-pipeline-result.js';
import { MAX_BROWSEABLE_SEARCH_RESULTS } from '../search-budget.js';

function memoryKv(
  onPut?: (options: { expirationTtl?: number }) => void,
): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string, options?: { expirationTtl?: number }) => {
      store.set(key, value);
      onPut?.(options ?? {});
    },
  } as unknown as KVNamespace;
}

describe('search cache', () => {
  it('preserves query text semantics while stabilizing filter order in plan keys', () => {
    const left = normalizeSearchRequestDto({
      query: 'Easy online GenEd',
      filters: { credits: 3, online: true },
    });
    const right = normalizeSearchRequestDto({
      query: 'Easy online GenEd',
      filters: { online: true, credits: 3 },
    });
    const differentCase = normalizeSearchRequestDto({
      query: 'easy online gened',
      filters: { online: true, credits: 3 },
    });

    expect(searchPlanCacheKey(left)).toBe(
      searchPlanCacheKey(right)
    );
    expect(searchPlanCacheKey(left)).not.toBe(
      searchPlanCacheKey(differentCase)
    );
  });

  it('keys canonical requests by exact query, filters, sort, and scope', () => {
    const left = normalizeSearchRequestDto({
      query: 'Easy online GenEd',
      filters: { credits: 3, online: true },
      sort: { field: 'gpa', direction: 'desc' },
      scope: 'all',
    });
    const right = normalizeSearchRequestDto({
      query: 'Easy online GenEd',
      filters: { online: true, credits: 3 },
      sort: { field: 'gpa', direction: 'desc' },
      scope: 'all',
    });
    const differentSort = normalizeSearchRequestDto({
      query: 'Easy online GenEd',
      filters: { online: true, credits: 3 },
      sort: { field: 'quality', direction: 'desc' },
      scope: 'all',
    });

    expect(searchPlanCacheKey(left)).toBe(searchPlanCacheKey(right));
    expect(searchResultCacheKey(left)).toBe(searchResultCacheKey(right));
    expect(searchResultCacheKey(left)).not.toBe(
      searchResultCacheKey(differentSort),
    );
  });

  it('does not collide queries whose casing changes planner meaning', () => {
    const subjectCode = normalizeSearchRequestDto({ query: 'IS 101' });
    const questionText = normalizeSearchRequestDto({ query: 'is 101' });

    expect(searchPlanCacheKey(subjectCode)).not.toBe(
      searchPlanCacheKey(questionText),
    );
    expect(searchResultCacheKey(subjectCode)).not.toBe(
      searchResultCacheKey(questionText),
    );
  });

  it('round-trips cached plans and result payloads through KV JSON', async () => {
    const expirationTtls: number[] = [];
    const kv = memoryKv((options) => {
      if (options.expirationTtl !== undefined) {
        expirationTtls.push(options.expirationTtl);
      }
    });
    const planning = {
      extraction: { hints: [], residual: '' },
      queryResidual: '',
      plan: {
        filters: { online: true },
        keywordQuery: '',
        semanticQuery: '',
      },
      compilerEvents: [],
    };
    const retrievalPlan: RetrievalPlan = {
      controls: { sort: { field: 'relevance', direction: 'desc' }, scope: 'active' },
      budget: {
        browseableResultLimit: MAX_BROWSEABLE_SEARCH_RESULTS,
        semanticLaneResultLimit: 100,
      },
      lanes: [],
      inputs: {
        filters: planning.plan.filters,
        keywordQuery: '',
        cleanKeywordQuery: '',
        titleQuery: '',
        semanticQuery: '',
        scope: 'active',
        semanticTermIds: [],
        sort: { field: 'relevance', direction: 'desc' },
      },
    };
    const result = {
      results: [],
      totalResults: 0,
      meta: {
        query: { raw: 'easy online gen ed', residual: '' },
        extraction: { hints: [] },
        compilerEvents: [],
        plan: planning.plan,
        retrievalPlan,
        retrievalExecution: {
          successfulLanes: [],
          failedLanes: [],
        },
      },
    } satisfies SearchPipelineResult;
    const request = normalizeSearchRequestDto({
      query: 'easy online gen ed',
      filters: { online: true },
    });

    await cacheSearchPlan(kv, request, planning);
    await cacheSearchResult(kv, request, result);

    await expect(getCachedSearchPlan(kv, request)).resolves.toEqual(planning);
    await expect(getCachedSearchResult(kv, request)).resolves.toEqual(result);
    expect(expirationTtls.every((ttl) => ttl >= 60)).toBe(true);
  });

  it('rejects a cache value whose verified request identity does not match', async () => {
    const kv = {
      get: async () => JSON.stringify({
        identity: '{"query":"different request"}',
        value: {
          extraction: { hints: [], residual: '' },
          queryResidual: '',
          plan: { filters: {}, keywordQuery: '', semanticQuery: '' },
          compilerEvents: [],
        },
      }),
    } as unknown as KVNamespace;
    const request = normalizeSearchRequestDto({ query: 'data structures' });

    await expect(getCachedSearchPlan(kv, request)).resolves.toBeNull();
  });

  it('does not cache partially degraded search results', async () => {
    const kv = memoryKv();
    const request = normalizeSearchRequestDto({ query: 'data structures' });
    const degradedResult = {
      results: [],
      totalResults: 0,
      meta: {
        query: { raw: request.query, residual: request.query },
        extraction: { hints: [] },
        compilerEvents: [],
        plan: {
          filters: {},
          keywordQuery: request.query,
          semanticQuery: request.query,
        },
        retrievalPlan: {
          controls: { sort: { field: 'relevance', direction: 'desc' }, scope: 'active' },
          budget: {
            browseableResultLimit: MAX_BROWSEABLE_SEARCH_RESULTS,
            semanticLaneResultLimit: 100,
          },
          lanes: [],
          inputs: {
            filters: {},
            keywordQuery: request.query,
            cleanKeywordQuery: request.query,
            titleQuery: request.query,
            semanticQuery: request.query,
            scope: 'active',
            semanticTermIds: [],
            sort: { field: 'relevance', direction: 'desc' },
          },
        },
        retrievalExecution: {
          successfulLanes: ['official_text'],
          failedLanes: ['topic_semantic'],
        },
      },
    } satisfies SearchPipelineResult;

    await cacheSearchResult(kv, request, degradedResult);

    await expect(getCachedSearchResult(kv, request)).resolves.toBeNull();
  });
});
