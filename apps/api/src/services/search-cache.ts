import type { KVNamespace } from "@cloudflare/workers-types";
import type { NormalizedSearchRequestDto } from "@uiuc-course-search/query-types";
import type { SearchPipelineResult } from "./search-pipeline-result.js";
import type {
  SearchPlanningResult,
} from "./search-plan-compiler.js";

// Bump whenever cached internal plan or pipeline-result shapes change.
const SEARCH_CACHE_VERSION = "v14";
const SEARCH_PLAN_TTL_SECONDS = 5 * 60;
const SEARCH_RESULT_TTL_SECONDS = 60;

export function searchPlanCacheKey(request: NormalizedSearchRequestDto): string {
  return cacheKey("plan", searchPlanRequestCachePayload(request));
}

export function searchResultCacheKey(
  request: NormalizedSearchRequestDto,
): string {
  return cacheKey("result", searchRequestCachePayload(request));
}

export async function getCachedSearchPlan(
  kv: KVNamespace | undefined,
  request: NormalizedSearchRequestDto,
): Promise<SearchPlanningResult | null> {
  return getJson<SearchPlanningResult>(
    kv,
    searchPlanCacheKey(request),
  );
}

export function cacheSearchPlan(
  kv: KVNamespace | undefined,
  request: NormalizedSearchRequestDto,
  planning: SearchPlanningResult,
): Promise<void> {
  return putJson(
    kv,
    searchPlanCacheKey(request),
    planning,
    SEARCH_PLAN_TTL_SECONDS,
  );
}

export async function getCachedSearchResult(
  kv: KVNamespace | undefined,
  request: NormalizedSearchRequestDto,
): Promise<SearchPipelineResult | null> {
  return getJson<SearchPipelineResult>(
    kv,
    searchResultCacheKey(request),
  );
}

export function cacheSearchResult(
  kv: KVNamespace | undefined,
  request: NormalizedSearchRequestDto,
  result: SearchPipelineResult,
): Promise<void> {
  return putJson(
    kv,
    searchResultCacheKey(request),
    result,
    SEARCH_RESULT_TTL_SECONDS,
  );
}

function cacheKey(
  kind: "plan" | "result",
  payload: Record<string, unknown>,
): string {
  return `search:${SEARCH_CACHE_VERSION}:${kind}:${hashStableJson(payload)}`;
}

function searchRequestCachePayload(
  request: NormalizedSearchRequestDto,
): Record<string, unknown> {
  return {
    query: request.query,
    filters: stableSearchRecord(request.filters),
    sort: stableSearchRecord(request.sort),
    scope: request.scope,
  };
}

function searchPlanRequestCachePayload(
  request: NormalizedSearchRequestDto,
): Record<string, unknown> {
  return {
    query: request.query,
    filters: stableSearchRecord(request.filters),
  };
}

function stableSearchRecord(value: object | undefined): Record<string, unknown> {
  if (!value) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function hashStableJson(value: unknown): string {
  const json = stableJson(value);
  let hash = 2166136261;
  for (let index = 0; index < json.length; index += 1) {
    hash ^= json.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function getJson<T>(
  kv: KVNamespace | undefined,
  key: string,
): Promise<T | null> {
  if (!kv) return null;
  const value = await kv.get(key, "text");
  if (!value) return null;
  return JSON.parse(value) as T;
}

async function putJson(
  kv: KVNamespace | undefined,
  key: string,
  value: unknown,
  expirationTtl: number,
): Promise<void> {
  if (!kv) return;
  await kv.put(key, JSON.stringify(value), { expirationTtl });
}
