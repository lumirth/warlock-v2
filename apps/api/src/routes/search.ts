import { Hono } from "hono";
import type {
  D1Database,
  VectorizeIndex,
  Ai,
  KVNamespace,
} from "@cloudflare/workers-types";
import { SearchPipeline } from "../services/search-pipeline.js";
import { parseSearchHttpRequest } from "../http/search-request.js";
import { presentSearchResponse } from "../services/search-response-presenter.js";
import { errorFields, logger } from "../observability/logger.js";

type Bindings = {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  SEARCH_CACHE?: KVNamespace;
  CURRENT_YEAR: string;
  CURRENT_TERM: string;
};

export const searchRoutes = new Hono<{ Bindings: Bindings }>();

// Hybrid search endpoint (combines semantic + keyword with RRF)
searchRoutes.get("/api/search", async (c) => {
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
    const response = await presentSearchResponse({
      db: c.env.DB,
      request,
      pagination,
      result,
    });

    return c.json(response);
  } catch (error) {
    logger.error("route.search.failed", { ...errorFields(error) });
    return c.json({ error: "Search failed" }, 500);
  }
});
