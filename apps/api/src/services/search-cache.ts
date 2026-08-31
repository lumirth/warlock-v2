import type { KVNamespace } from "@cloudflare/workers-types";
import type { NormalizedSearchRequestDto } from "@uiuc-course-search/query-types";
import type { SearchPipelineResult } from "./search-types.js";

const identity = (request: NormalizedSearchRequestDto) => JSON.stringify(request);
const key = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return `search:${hash >>> 0}`;
};

export async function getCachedSearchResult(
  cache: KVNamespace | undefined,
  request: NormalizedSearchRequestDto,
): Promise<SearchPipelineResult | null> {
  if (!cache) return null;
  const requestIdentity = identity(request);
  const value = await cache.get(key(requestIdentity), "text");
  if (!value) return null;
  try {
    const entry = JSON.parse(value) as { request: string; result: SearchPipelineResult };
    return entry.request === requestIdentity ? entry.result : null;
  } catch { return null; }
}

export async function cacheSearchResult(
  cache: KVNamespace | undefined,
  request: NormalizedSearchRequestDto,
  result: SearchPipelineResult,
): Promise<void> {
  if (!cache || result.meta.failedLanes.length) return;
  const requestIdentity = identity(request);
  await cache.put(key(requestIdentity), JSON.stringify({ request: requestIdentity, result }), {
    expirationTtl: 60,
  });
}
