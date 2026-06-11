import type { Ai, D1Database, VectorizeIndex } from "@cloudflare/workers-types";
import { normalizeSearchRequestDto, type SearchResponseDto } from "@uiuc-course-search/query-types";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { searchRoutes } from "../search.js";
import { SearchPipeline } from "../../services/search-pipeline.js";
import { presentSearchResponse } from "../../services/search-response-presenter.js";

vi.mock("../../services/search-pipeline.js");
vi.mock("../../services/search-response-presenter.js");

type SearchRouteBindings = {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
};

describe("search route adapter", () => {
  let app: Hono<{ Bindings: SearchRouteBindings }>;
  let bindings: SearchRouteBindings;

  beforeEach(() => {
    app = new Hono();
    app.route("/", searchRoutes);
    bindings = {
      DB: {} as D1Database,
      VECTORIZE: {} as VectorizeIndex,
      AI: {} as Ai,
    };
    vi.clearAllMocks();
    vi.mocked(presentSearchResponse).mockReturnValue(emptySearchResponse());
  });

  it("decodes a valid request and delegates it to SearchPipeline", async () => {
    const pipelineResult = { result: "owned by the application service" };
    const search = vi.fn().mockResolvedValue(pipelineResult);
    vi.mocked(SearchPipeline).mockImplementation(function () {
      return { search } as unknown as SearchPipeline;
    });

    const response = await app.request(
      "/api/search?q=systems&subject=cs&sort=gpa&direction=asc&scope=all",
      {},
      bindings,
      executionContext(),
    );

    expect(response.status).toBe(200);
    expect(search).toHaveBeenCalledWith(
      {
        query: "systems",
        filters: { subject: "CS" },
        sort: { field: "gpa", direction: "asc" },
        scope: "all",
      },
      expect.any(Function),
    );
    expect(presentSearchResponse).toHaveBeenCalledWith({
      request: {
        query: "systems",
        filters: { subject: "CS" },
        sort: { field: "gpa", direction: "asc" },
        scope: "all",
      },
      pagination: { limit: 20, offset: 0 },
      result: pipelineResult,
    });
  });

  it("rejects malformed public params before constructing a search", async () => {
    const search = vi.fn();
    vi.mocked(SearchPipeline).mockImplementation(function () {
      return { search } as unknown as SearchPipeline;
    });

    const response = await app.request(
      "/api/search?q=cs&limit=999999",
      {},
      bindings,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "limit must be between 1 and 50",
    });
    expect(search).not.toHaveBeenCalled();
  });

  it("does not expose internal search failures", async () => {
    vi.mocked(SearchPipeline).mockImplementation(function () {
      return {
        search: vi.fn().mockRejectedValue(new Error("D1_ERROR: private detail")),
      } as unknown as SearchPipeline;
    });

    const response = await app.request(
      "/api/search?q=history",
      {},
      bindings,
      executionContext(),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Search failed" });
  });
});

function executionContext(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
}

function emptySearchResponse(): SearchResponseDto {
  const request = normalizeSearchRequestDto({ query: "" });
  return {
    results: [],
    meta: {
      nextRequest: request,
      interpretedRequest: request,
      ui: { chips: [], ambiguityActions: [] },
    },
    pagination: {
      totalResults: 0,
      browseableResults: 0,
      limit: 20,
      offset: 0,
      hasMore: false,
      nextOffset: null,
    },
  };
}
