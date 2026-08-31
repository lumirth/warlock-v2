import { Hono } from "hono";
import { decodeSearchRequestQuery } from "@uiuc-course-search/query-types";
import type {
  D1Database,
  VectorizeIndex,
  Ai,
  KVNamespace,
} from "@cloudflare/workers-types";
import { SearchPipeline } from "../services/search-pipeline.js";
import { presentSearchResponse } from "../services/search-response-presenter.js";
import { errorFields, logger } from "../observability/logger.js";

type Bindings = {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  SEARCH_CACHE?: KVNamespace;
};

export const searchRoutes = new Hono<{ Bindings: Bindings }>();

searchRoutes.get("/api/search", async (c) => {
  const searchParams = new URL(c.req.url).searchParams;
  const parsedRequest = decodeSearchRequestQuery(searchParams);
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
    const response = presentSearchResponse({
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
