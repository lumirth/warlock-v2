import type { KVNamespace } from "@cloudflare/workers-types";
import type {
  SearchPipelineResult,
  SearchPlanningResult,
} from "./search-pipeline.js";

const SEARCH_CACHE_VERSION = "v8";
const SEARCH_PLAN_TTL_SECONDS = 5 * 60;
const SEARCH_RESULT_TTL_SECONDS = 30;

type CacheableOverrides = object;

export function searchPlanCacheKey(
  rawQuery: string,
  overrides?: CacheableOverrides,
): string {
  return cacheKey("plan", {
    query: normalizeQuery(rawQuery),
    overrides: stableRecord(overrides),
  });
}

export function searchResultCacheKey(
  rawQuery: string,
  limit: number,
  overrides?: CacheableOverrides,
  controls?: CacheableOverrides,
): string {
  return cacheKey("result", {
    query: normalizeQuery(rawQuery),
    limit,
    overrides: stableRecord(overrides),
    controls: stableRecord(controls),
  });
}

export async function getCachedSearchPlan(
  kv: KVNamespace | undefined,
  rawQuery: string,
  overrides?: CacheableOverrides,
): Promise<SearchPlanningResult | null> {
  return getJson<SearchPlanningResult>(
    kv,
    searchPlanCacheKey(rawQuery, overrides),
  );
}

export function cacheSearchPlan(
  kv: KVNamespace | undefined,
  rawQuery: string,
  planning: SearchPlanningResult,
  overrides?: CacheableOverrides,
): Promise<void> {
  return putJson(
    kv,
    searchPlanCacheKey(rawQuery, overrides),
    planning,
    SEARCH_PLAN_TTL_SECONDS,
  );
}

export async function getCachedSearchResult(
  kv: KVNamespace | undefined,
  rawQuery: string,
  limit: number,
  overrides?: CacheableOverrides,
  controls?: CacheableOverrides,
): Promise<SearchPipelineResult | null> {
  return getJson<SearchPipelineResult>(
    kv,
    searchResultCacheKey(rawQuery, limit, overrides, controls),
  );
}

export function cacheSearchResult(
  kv: KVNamespace | undefined,
  rawQuery: string,
  limit: number,
  result: SearchPipelineResult,
  overrides?: CacheableOverrides,
  controls?: CacheableOverrides,
): Promise<void> {
  return putJson(
    kv,
    searchResultCacheKey(rawQuery, limit, overrides, controls),
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

function normalizeQuery(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function stableRecord(
  value: CacheableOverrides | undefined,
): Record<string, unknown> {
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
