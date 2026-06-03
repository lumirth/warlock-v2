import { describe, expect, it } from 'vitest';
import type { KVNamespace } from '@cloudflare/workers-types';
import {
  cacheSearchPlan,
  cacheSearchResult,
  getCachedSearchPlan,
  getCachedSearchResult,
  searchPlanCacheKey,
} from '../search-cache.js';

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
    expect(searchPlanCacheKey(' Easy   Online Gen Ed ', { credits: 3, online: true })).toBe(
      searchPlanCacheKey('easy online gen ed', { online: true, credits: 3 })
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
    const result = {
      results: [],
      meta: {
        query: { raw: 'easy online gen ed', residual: '' },
        extraction: { hints: [] },
        plan: planning.plan,
        timing: { extraction_ms: 1, search_ms: 1, total_ms: 2 },
        fallback: { tierReached: 2, constraintsRelaxed: [], originalResultCount: 0 },
      },
    };

    await cacheSearchPlan(kv, 'easy online gen ed', planning, { online: true });
    await cacheSearchResult(kv, 'easy online gen ed', 20, result, { online: true });

    await expect(getCachedSearchPlan(kv, ' EASY online   gen ed ', { online: true })).resolves.toEqual(planning);
    await expect(getCachedSearchResult(kv, 'easy online gen ed', 20, { online: true })).resolves.toEqual(result);
  });
});
