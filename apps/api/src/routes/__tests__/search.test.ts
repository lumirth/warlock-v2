import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { searchRoutes } from "../search.js";
import { SearchPipeline } from "../../services/search-pipeline.js";
import type { D1Database, VectorizeIndex, Ai } from "@cloudflare/workers-types";
import {
  singleRequirementFilter,
  type SearchResponseDto,
} from "@uiuc-course-search/query-types";

vi.mock("../../services/search-pipeline.js");

type SearchRouteBindings = {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
};

describe("Search Routes", () => {
  let app: Hono<{ Bindings: SearchRouteBindings }>;
  let mockDB: D1Database;
  let mockVectorize: VectorizeIndex;
  let mockAI: Ai;

  beforeEach(() => {
    mockDB = {
      prepare: vi.fn().mockReturnThis(),
      bind: vi.fn().mockReturnThis(),
      all: vi.fn().mockResolvedValue({ results: [] }),
    } as unknown as D1Database;
    mockVectorize = {} as unknown as VectorizeIndex;
    mockAI = {} as unknown as Ai;

    app = new Hono();
    app.route("/", searchRoutes);
    vi.clearAllMocks();
  });

  it("GET /api/search should use SearchPipeline", async () => {
    const mockResults = [
      {
        course: {
          id: "CS-225-2026-spring",
          subject: "CS",
          number: "225",
          title: "Data Structures",
          description: null,
          credit_hours: 4,
          gened: null,
          year: 2026,
          term: "spring",
          avg_gpa: null,
          gpa_sample_size: null,
          primary_instructor: null,
          primary_instructor_rmp: null,
          quality_score: null,
          difficulty_score: null,
        },
        score: 0.9,
        semanticRank: 1,
        keywordRank: 1,
        termPriority: 0,
        historical: false,
      },
    ];

    const mockPipelineResult = {
      results: mockResults,
      meta: {
        query: { raw: "CS 225", residual: "" },
        extraction: { hints: [] },
        plan: { filters: {}, semanticQuery: "", keywordQuery: "" },
        timing: { extraction_ms: 10, search_ms: 20, total_ms: 30 },
      },
    };

    const searchSpy = vi.fn().mockResolvedValue(mockPipelineResult);
    vi.mocked(SearchPipeline).mockImplementation(function () {
      return {
        search: searchSpy,
      } as unknown as SearchPipeline;
    });

    const res = await app.request(
      "/api/search?q=CS+225",
      {},
      {
        DB: mockDB,
        VECTORIZE: mockVectorize,
        AI: mockAI,
      },
      {
        waitUntil: vi.fn(),
        passThroughOnException: vi.fn(),
      } as unknown as ExecutionContext,
    );

    if (res.status !== 200) {
      console.error(await res.text());
    }

    expect(res.status).toBe(200);
    const data = (await res.json()) as SearchResponseDto;
    expect(data.results).toBeDefined();
    expect(data.results[0].course.id).toBe("CS-225-2026-spring");
    expect("plan" in data.meta).toBe(false);
    expect("extraction" in data.meta).toBe(false);
    expect(data.meta.ui).toEqual({
      chips: [],
      ambiguityActions: [],
    });
    expect(searchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "CS 225",
        filters: {},
        sort: { field: "relevance", direction: "desc" },
        scope: "active",
      }),
      { limit: 20, offset: 0 },
      expect.any(Function),
    );
  });

  it("does not expose planner debug on the public search endpoint", async () => {
    const searchSpy = vi.fn().mockResolvedValue({
      results: [],
      meta: {
        query: { raw: "CS 225", residual: "" },
        extraction: { hints: [] },
        compilerEvents: [],
        plan: { filters: {}, semanticQuery: "", keywordQuery: "" },
        retrievalPlan: {},
        retrievalPlans: [],
        budget: {},
        timing: { extraction_ms: 1, search_ms: 1, total_ms: 2 },
        fallback: { tierReached: 2, constraintsRelaxed: [], originalResultCount: 0 },
      },
    });
    vi.mocked(SearchPipeline).mockImplementation(function () {
      return {
        search: searchSpy,
      } as unknown as SearchPipeline;
    });

    const res = await app.request(
      "/api/search?q=CS+225&debug=planner",
      {},
      {
        DB: mockDB,
        VECTORIZE: mockVectorize,
        AI: mockAI,
      },
      {
        waitUntil: vi.fn(),
        passThroughOnException: vi.fn(),
      } as unknown as ExecutionContext,
    );

    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>;
    expect(data._debug).toBeUndefined();
  });

  it("rejects malformed public search params before running search", async () => {
    const searchSpy = vi.fn();
    vi.mocked(SearchPipeline).mockImplementation(function () {
      return {
        search: searchSpy,
      } as unknown as SearchPipeline;
    });

    const res = await app.request(
      "/api/search?q=cs&limit=999999",
      {},
      {
        DB: mockDB,
        VECTORIZE: mockVectorize,
        AI: mockAI,
      },
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "limit must be between 1 and 50",
    });
    expect(searchSpy).not.toHaveBeenCalled();
  });

  it("normalizes bounded manual search filters", async () => {
    const searchSpy = vi.fn().mockResolvedValue({
      results: [],
      meta: {
        query: { raw: "systems", residual: "systems" },
        extraction: { hints: [] },
        plan: {
          filters: {},
          semanticQuery: "systems",
          keywordQuery: "systems",
        },
        timing: { extraction_ms: 1, search_ms: 1, total_ms: 2 },
      },
    });
    vi.mocked(SearchPipeline).mockImplementation(function () {
      return {
        search: searchSpy,
      } as unknown as SearchPipeline;
    });

    const res = await app.request(
      "/api/search?q=systems&subject=cs&number=225&instructor=Fagen&term=spring&year=2026&requirement=hum&credits=4&days=mwf&time=morning&online=true&status=open&workload=easy&level=400",
      {},
      {
        DB: mockDB,
        VECTORIZE: mockVectorize,
        AI: mockAI,
      },
      {
        waitUntil: vi.fn(),
        passThroughOnException: vi.fn(),
      } as unknown as ExecutionContext,
    );

    expect(res.status).toBe(200);
    expect(searchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "systems",
        filters: {
          subject: "CS",
          number: "225",
          instructor: "Fagen",
          term: "spring",
          year: 2026,
          requirement: singleRequirementFilter("HUM"),
          credits: 4,
          days: "MWF",
          time: "morning",
          online: true,
          status: "open",
          workload: "easy",
          level: 400,
        },
        sort: { field: "relevance", direction: "desc" },
        scope: "active",
      }),
      { limit: 20, offset: 0 },
      expect.any(Function),
    );
  });

  it("allows filter-only searches without fabricating query text", async () => {
    const searchSpy = vi.fn().mockResolvedValue({
      results: [],
      meta: {
        query: { raw: "", residual: "" },
        extraction: { hints: [] },
        plan: {
          filters: { online: true },
          semanticQuery: "",
          keywordQuery: "",
        },
        timing: { extraction_ms: 1, search_ms: 1, total_ms: 2 },
      },
    });
    vi.mocked(SearchPipeline).mockImplementation(function () {
      return {
        search: searchSpy,
      } as unknown as SearchPipeline;
    });

    const res = await app.request(
      "/api/search?online=true&credits=3",
      {},
      {
        DB: mockDB,
        VECTORIZE: mockVectorize,
        AI: mockAI,
      },
      {
        waitUntil: vi.fn(),
        passThroughOnException: vi.fn(),
      } as unknown as ExecutionContext,
    );

    expect(res.status).toBe(200);
    expect(searchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "",
        filters: { credits: 3, online: true },
        sort: { field: "relevance", direction: "desc" },
        scope: "active",
      }),
      { limit: 20, offset: 0 },
      expect.any(Function),
    );
  });

  it("passes sort, all-term scope, and level controls to the pipeline", async () => {
    const searchSpy = vi.fn().mockResolvedValue({
      results: [],
      meta: {
        query: { raw: "history", residual: "history" },
        extraction: { hints: [] },
        plan: {
          filters: { level: 500 },
          semanticQuery: "history",
          keywordQuery: "history",
        },
        timing: { extraction_ms: 1, search_ms: 1, total_ms: 2 },
      },
    });
    vi.mocked(SearchPipeline).mockImplementation(function () {
      return {
        search: searchSpy,
      } as unknown as SearchPipeline;
    });

    const res = await app.request(
      "/api/search?q=history&limit=5&sort=gpa&direction=asc&scope=all&level=500",
      {},
      {
        DB: mockDB,
        VECTORIZE: mockVectorize,
        AI: mockAI,
      },
      {
        waitUntil: vi.fn(),
        passThroughOnException: vi.fn(),
      } as unknown as ExecutionContext,
    );

    expect(res.status).toBe(200);
    expect(searchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "history",
        filters: { level: 500 },
        sort: { field: "gpa", direction: "asc" },
        scope: "all",
      }),
      { limit: 5, offset: 0 },
      expect.any(Function),
    );

    const data = (await res.json()) as SearchResponseDto;
    expect(data.meta.appliedSort).toEqual({ field: "gpa", direction: "asc" });
    expect(data.meta.appliedScope).toBe("all");
    expect(data.meta.nextRequest).toMatchObject({
      query: "history",
      filters: { level: 500 },
      sort: { field: "gpa", direction: "asc" },
      scope: "all",
    });
  });

  it("separates executable continuation from interpreted display request", async () => {
    const searchSpy = vi.fn().mockResolvedValue({
      results: [],
      meta: {
        query: { raw: "highest gpa classes", residual: "" },
        extraction: { hints: [] },
        plan: {
          filters: {},
          semanticQuery: "",
          keywordQuery: "",
          softPreferences: {
            inferredSort: { field: "gpa", direction: "desc" },
          },
        },
        timing: { extraction_ms: 1, search_ms: 1, total_ms: 2 },
        fallback: { tierReached: 2, constraintsRelaxed: [], originalResultCount: 0 },
        appliedSort: { field: "gpa", direction: "desc" },
        appliedScope: "active",
      },
    });
    vi.mocked(SearchPipeline).mockImplementation(function () {
      return {
        search: searchSpy,
      } as unknown as SearchPipeline;
    });

    const res = await app.request(
      "/api/search?q=highest+gpa+classes",
      {},
      {
        DB: mockDB,
        VECTORIZE: mockVectorize,
        AI: mockAI,
      },
      {
        waitUntil: vi.fn(),
        passThroughOnException: vi.fn(),
      } as unknown as ExecutionContext,
    );

    expect(res.status).toBe(200);
    const data = (await res.json()) as SearchResponseDto;
    expect(data.meta.appliedSort).toEqual({ field: "gpa", direction: "desc" });
    expect(data.meta.nextRequest).toMatchObject({
      query: "highest gpa classes",
      sort: { field: "gpa", direction: "desc" },
      scope: "active",
    });
    expect(data.meta.interpretedRequest).toMatchObject({
      query: "",
      sort: { field: "gpa", direction: "desc" },
      scope: "active",
    });
  });

  it("rejects invalid new controls instead of silently falling back", async () => {
    const searchSpy = vi.fn().mockResolvedValue({
      results: [],
      meta: {
        query: { raw: "history", residual: "history" },
        extraction: { hints: [] },
        plan: {
          filters: {},
          semanticQuery: "history",
          keywordQuery: "history",
        },
        timing: { extraction_ms: 1, search_ms: 1, total_ms: 2 },
      },
    });
    vi.mocked(SearchPipeline).mockImplementation(function () {
      return {
        search: searchSpy,
      } as unknown as SearchPipeline;
    });

    const res = await app.request(
      "/api/search?q=history&sort=nope&direction=sideways&scope=past&level=700",
      {},
      {
        DB: mockDB,
        VECTORIZE: mockVectorize,
        AI: mockAI,
      },
      {
        waitUntil: vi.fn(),
        passThroughOnException: vi.fn(),
      } as unknown as ExecutionContext,
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "sort must be one of: relevance, gpa, quality, workload, instructor_rating, level, credits",
    });
    expect(searchSpy).not.toHaveBeenCalled();
  });

  it("rejects level filters with trailing malformed characters", async () => {
    const searchSpy = vi.fn().mockResolvedValue({
      results: [],
      meta: {
        query: { raw: "history", residual: "history" },
        extraction: { hints: [] },
        plan: {
          filters: {},
          semanticQuery: "history",
          keywordQuery: "history",
        },
        timing: { extraction_ms: 1, search_ms: 1, total_ms: 2 },
      },
    });
    vi.mocked(SearchPipeline).mockImplementation(function () {
      return {
        search: searchSpy,
      } as unknown as SearchPipeline;
    });

    const res = await app.request(
      "/api/search?q=history&level=100abc",
      {},
      {
        DB: mockDB,
        VECTORIZE: mockVectorize,
        AI: mockAI,
      },
      {
        waitUntil: vi.fn(),
        passThroughOnException: vi.fn(),
      } as unknown as ExecutionContext,
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "level must be an integer",
    });
    expect(searchSpy).not.toHaveBeenCalled();
  });

  it("returns a stable generic response for internal search failures", async () => {
    vi.mocked(SearchPipeline).mockImplementation(function () {
      return {
        search: vi.fn().mockRejectedValue(new Error("D1_ERROR: private detail")),
      } as unknown as SearchPipeline;
    });

    const res = await app.request(
      "/api/search?q=history",
      {},
      {
        DB: mockDB,
        VECTORIZE: mockVectorize,
        AI: mockAI,
      },
      {
        waitUntil: vi.fn(),
        passThroughOnException: vi.fn(),
      } as unknown as ExecutionContext,
    );

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "Search failed" });
  });

  it("returns a sliced page with hasMore and nextOffset", async () => {
    const mockResults = Array.from({ length: 16 }, (_, index) => ({
      course: {
        id: `CS-${index}-2026-spring`,
        subject: "CS",
        number: String(100 + index),
        title: `Course ${index}`,
        description: null,
        credit_hours: 3,
        gened: null,
        year: 2026,
        term: "spring",
        avg_gpa: null,
        gpa_sample_size: null,
        primary_instructor: null,
        primary_instructor_rmp: null,
        quality_score: null,
        difficulty_score: null,
      },
      score: 1 - index / 100,
    }));
    const searchSpy = vi.fn().mockResolvedValue({
      results: mockResults,
      meta: {
        query: { raw: "intro to CS", residual: "" },
        extraction: { hints: [] },
        plan: {
          filters: { subject: "CS" },
          semanticQuery: "",
          keywordQuery: "",
        },
        timing: { extraction_ms: 1, search_ms: 1, total_ms: 2 },
      },
    });
    vi.mocked(SearchPipeline).mockImplementation(function () {
      return {
        search: searchSpy,
      } as unknown as SearchPipeline;
    });

    const res = await app.request(
      "/api/search?q=intro+to+CS&limit=5&offset=10",
      {},
      {
        DB: mockDB,
        VECTORIZE: mockVectorize,
        AI: mockAI,
      },
      {
        waitUntil: vi.fn(),
        passThroughOnException: vi.fn(),
      } as unknown as ExecutionContext,
    );

    expect(res.status).toBe(200);
    const data = (await res.json()) as SearchResponseDto;
    expect(searchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "intro to CS",
        filters: {},
        sort: { field: "relevance", direction: "desc" },
        scope: "active",
      }),
      { limit: 5, offset: 10 },
      expect.any(Function),
    );
    expect(data.results.map((result) => result.course.id)).toEqual([
      "CS-10-2026-spring",
      "CS-11-2026-spring",
      "CS-12-2026-spring",
      "CS-13-2026-spring",
      "CS-14-2026-spring",
    ]);
    expect(data.pagination).toEqual({
      resultCountLowerBound: 16,
      limit: 5,
      offset: 10,
      hasMore: true,
      nextOffset: 15,
    });
  });

  it("allows deep historical result pages while keeping an offset cap", async () => {
    const searchSpy = vi.fn().mockResolvedValue({
      results: [],
      meta: {
        query: { raw: "history", residual: "history" },
        extraction: { hints: [] },
        plan: {
          filters: {},
          semanticQuery: "history",
          keywordQuery: "history",
        },
        timing: { extraction_ms: 1, search_ms: 1, total_ms: 2 },
      },
    });
    vi.mocked(SearchPipeline).mockImplementation(function () {
      return {
        search: searchSpy,
      } as unknown as SearchPipeline;
    });

    const ok = await app.request(
      "/api/search?q=history&offset=1000",
      {},
      {
        DB: mockDB,
        VECTORIZE: mockVectorize,
        AI: mockAI,
      },
      {
        waitUntil: vi.fn(),
        passThroughOnException: vi.fn(),
      } as unknown as ExecutionContext,
    );
    expect(ok.status).toBe(200);
    expect(searchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "history",
        filters: {},
        sort: { field: "relevance", direction: "desc" },
        scope: "active",
      }),
      { limit: 20, offset: 1000 },
      expect.any(Function),
    );

    const tooDeep = await app.request(
      "/api/search?q=history&offset=1001",
      {},
      {
        DB: mockDB,
        VECTORIZE: mockVectorize,
        AI: mockAI,
      },
    );
    expect(tooDeep.status).toBe(400);
    await expect(tooDeep.json()).resolves.toEqual({
      error: "offset must be between 0 and 1000",
    });
  });
});
