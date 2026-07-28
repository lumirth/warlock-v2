import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  normalizeSearchRequestDto,
  singleRequirementFilter,
} from "@uiuc-course-search/query-types";
import { SearchPipeline } from "../search-pipeline.js";
import {
  MAX_BROWSEABLE_SEARCH_RESULTS,
  buildSearchCandidateBudget,
} from "../search-budget.js";
import type { D1Database, VectorizeIndex, Ai } from "@cloudflare/workers-types";
import * as extractor from "../extractor.js";
import * as queryResolver from "../query-resolver.js";
import * as searchExecutor from "../search-executor.js";
import * as topicRegistry from "../topic-registry.js";
import type { Course } from "../../db/types.js";
import type { ExtractionResult } from "../extractor.js";
import type { SearchResult } from "../search-types.js";
import type { SearchPlan } from "../search-planner-types.js";

vi.mock("../extractor.js");
vi.mock("../query-resolver.js");
vi.mock("../search-executor.js");
vi.mock("../topic-registry.js");

function request(query: string, filters = {}) {
  return normalizeSearchRequestDto({ query, filters });
}

function planFromFirstSearchCall(): SearchPlan {
  return vi.mocked(searchExecutor.executeSearchPlan).mock.calls[0][3];
}

function budgetFromFirstSearchCall() {
  return vi.mocked(searchExecutor.executeSearchPlan).mock.calls[0][5]!;
}

function controlsFromFirstSearchCall() {
  return vi.mocked(searchExecutor.executeSearchPlan).mock.calls[0][4];
}

function mockExecution(results: SearchResult[]): void {
  vi.mocked(searchExecutor.executeSearchPlan).mockImplementation(
    async (_db, _vectorize, _ai, plan, controls, budget = buildSearchCandidateBudget()) => ({
      results,
      totalResults: results.length,
      retrievalPlan: {
        controls,
        budget,
        lanes: [],
        inputs: {
          filters: plan.filters,
          keywordQuery: plan.keywordQuery,
          cleanKeywordQuery: plan.keywordQuery,
          titleQuery: "",
          semanticQuery: plan.semanticQuery,
          scope: controls.scope,
          semanticTermIds: [],
          sort: controls.sort,
        },
      },
      retrievalExecution: {
        successfulLanes: [],
        failedLanes: [],
      },
    }),
  );
}

const mockCourse = (overrides: Partial<Course> = {}): Course => ({
  id: "CS-225-2025-fall",
  subject: "CS",
  number: "225",
  title: "Data Structures",
  description: "Data structures and algorithms.",
  credit_hours: 4,
  year: 2025,
  term: "fall",
  avg_gpa: 3.5,
  gpa_sample_size: 1000,
  primary_instructor: "Fagen-Ulmschneider, G",
  primary_instructor_rmp: 4.5,
  difficulty_score: 35,
  quality_score: 88,
  subject_id: "CS",
  course_info: null,
  degree_attributes: null,
  class_schedule_info: null,
  date_range_text: null,
  registration_notes: null,
  approval_code: null,
  last_synced: 0,
  created_at: 0,
  updated_at: 0,
  ...overrides,
  credit_hours_text:
    overrides.credit_hours_text === undefined
      ? "4 hours."
      : overrides.credit_hours_text,
});

describe("SearchPipeline", () => {
  let db: D1Database;
  let vectorize: VectorizeIndex;
  let ai: Ai;
  let pipeline: SearchPipeline;

  beforeEach(() => {
    db = { prepare: vi.fn() } as unknown as D1Database;
    vectorize = {} as unknown as VectorizeIndex;
    ai = {} as unknown as Ai;
    pipeline = new SearchPipeline(db, vectorize, ai);
    vi.clearAllMocks();
    vi.mocked(topicRegistry.expandTopics).mockReturnValue([]);
  });

  it("Tier 1: should return results immediately for navigational queries", async () => {
    const query = "CS 225";
    const mockExtracted: ExtractionResult = {
      hints: [
        {
          type: "courseCode",
          value: { subject: "CS", number: "225" },
          metadata: { source: "regex", confidence: 0.95, raw: "CS 225" },
        },
      ],
      residual: "",
    };
    const mockPlan: SearchPlan = {
      filters: { subject: "CS", number: "225" },
      semanticQuery: "",
      keywordQuery: "",
    };
    const mockResults: SearchResult[] = [
      {
        course: mockCourse({ id: "CS-225", subject: "CS", number: "225" }),
        score: 1.0,
      },
    ];

    vi.mocked(extractor.extract).mockReturnValue(mockExtracted);
    vi.mocked(queryResolver.resolveQuery).mockResolvedValue(mockPlan);
    mockExecution(mockResults);

    const result = await pipeline.search(request(query));

    expect(result.results).toEqual(mockResults);
    expect(searchExecutor.executeSearchPlan).toHaveBeenCalledTimes(1);
  });

  it("Tier 2: should stop if structured search returns >= 3 results", async () => {
    const query = "CS 400 level";
    const mockExtracted: ExtractionResult = {
      hints: [
        {
          type: "subject",
          value: "CS",
          metadata: { source: "regex", confidence: 0.9, raw: "CS" },
        },
        {
          type: "level",
          value: 400,
          metadata: { source: "regex", confidence: 0.9, raw: "400 level" },
        },
      ],
      residual: "",
    };
    const mockPlan: SearchPlan = {
      filters: { subject: "CS", level: 400 },
      semanticQuery: "",
      keywordQuery: "",
    };
    const mockResults: SearchResult[] = Array(5)
      .fill(null)
      .map((_, i) => ({
        course: mockCourse({ id: `CS-${i}`, subject: "CS" }),
        score: 0.8,
      }));

    vi.mocked(extractor.extract).mockReturnValue(mockExtracted);
    vi.mocked(queryResolver.resolveQuery).mockResolvedValue(mockPlan);
    mockExecution(mockResults);

    const result = await pipeline.search(request(query));

    expect(result.results).toEqual(mockResults);
    expect(searchExecutor.executeSearchPlan).toHaveBeenCalledTimes(1);
  });

  it("widens internal candidates for introductory gateway intent without changing requested result count", async () => {
    const query = "intro to CS";
    const mockExtracted: ExtractionResult = {
      hints: [
        {
          type: "subject",
          value: "CS",
          metadata: { source: "regex", confidence: 0.9, raw: "CS" },
        },
        {
          type: "levelBoost",
          value: 100,
          metadata: { source: "regex", confidence: 0.85, raw: "intro" },
        },
      ],
      residual: "intro to CS",
    };
    const mockPlan: SearchPlan = {
      filters: { subject: "CS" },
      semanticQuery: "",
      keywordQuery: "",
      softPreferences: { levelBoost: 100 },
    };
    const mockResults: SearchResult[] = Array.from(
      { length: 40 },
      (_, index) => ({
        course: mockCourse({
          id: `CS-${index}`,
          subject: "CS",
          number: String(100 + index),
        }),
        score: 1 - index / 100,
      }),
    );

    vi.mocked(extractor.extract).mockReturnValue(mockExtracted);
    vi.mocked(queryResolver.resolveQuery).mockResolvedValue(mockPlan);
    mockExecution(mockResults);

    const result = await pipeline.search(request(query));

    expect(planFromFirstSearchCall()).toMatchObject({
        introductoryGateway: true,
        softPreferences: { levelBoost: 100 },
    });
    expect(
      budgetFromFirstSearchCall().browseableResultLimit,
    ).toBe(MAX_BROWSEABLE_SEARCH_RESULTS);
    expect(result.results).toHaveLength(40);
  });

  it("uses the same browseable result universe for ordinary relevance searches", () => {
    expect(
      buildSearchCandidateBudget()
        .browseableResultLimit,
    ).toBe(MAX_BROWSEABLE_SEARCH_RESULTS);
  });

  it("infers attribute sort intent from superlative queries", async () => {
    const query = "highest gpa classes";
    vi.mocked(extractor.extract).mockReturnValue({
      hints: [],
      residual: "highest gpa",
    });
    vi.mocked(queryResolver.resolveQuery).mockResolvedValue({
      filters: {},
      semanticQuery: "highest gpa",
      keywordQuery: "highest gpa",
    });
    mockExecution([
      { course: mockCourse({ id: "HIGH", avg_gpa: 3.9 }), score: 1 },
      { course: mockCourse({ id: "LOW", avg_gpa: 3.1 }), score: 2 },
    ]);

    const result = await pipeline.search(request(query));

    expect(planFromFirstSearchCall()).toMatchObject({
        keywordQuery: "",
        semanticQuery: "",
        softPreferences: expect.objectContaining({
          inferredSort: { field: "gpa", direction: "desc" },
        }),
    });
    expect(
      budgetFromFirstSearchCall().browseableResultLimit,
    ).toBe(MAX_BROWSEABLE_SEARCH_RESULTS);
    expect(controlsFromFirstSearchCall().sort).toEqual({ field: "gpa", direction: "desc" });
    expect(result.results[0].course.id).toBe("HIGH");
  });

  it("infers explicit sort-by commands without leaving sort words in the residual query", async () => {
    const query = "sort by instructor difficulty";
    vi.mocked(extractor.extract).mockReturnValue({
      hints: [],
      residual: "sort by instructor difficulty",
    });
    vi.mocked(queryResolver.resolveQuery).mockResolvedValue({
      filters: {},
      semanticQuery: "sort by instructor difficulty",
      keywordQuery: "sort by instructor difficulty",
    });
    mockExecution([
      { course: mockCourse({ id: "EASY", difficulty_score: 12 }), score: 1 },
      { course: mockCourse({ id: "HARD", difficulty_score: 82 }), score: 2 },
    ]);

    const result = await pipeline.search(request(query));

    expect(planFromFirstSearchCall()).toMatchObject({
        keywordQuery: "",
        semanticQuery: "",
        softPreferences: expect.objectContaining({
          inferredSort: { field: "instructor_difficulty", direction: "asc" },
        }),
    });
    expect(
      budgetFromFirstSearchCall().browseableResultLimit,
    ).toBe(MAX_BROWSEABLE_SEARCH_RESULTS);
    expect(controlsFromFirstSearchCall().sort).toEqual({
      field: "instructor_difficulty",
      direction: "asc",
    });
    expect(result.results[0].course.id).toBe("EASY");
  });

  it("applies topic expansions to the initial search plan", async () => {
    const query = "ml courses";
    const mockExtracted: ExtractionResult = { hints: [], residual: "ml" };
    const mockPlan: SearchPlan = {
      filters: {},
      semanticQuery: "ml",
      keywordQuery: "ml",
    };

    vi.mocked(extractor.extract).mockReturnValue(mockExtracted);
    vi.mocked(queryResolver.resolveQuery).mockResolvedValue(mockPlan);
    vi.mocked(topicRegistry.expandTopics).mockReturnValue(["machine learning"]);

    mockExecution([
      { course: mockCourse({ id: "1" }), score: 0.5 },
    ]);

    const result = await pipeline.search(request(query));

    expect(topicRegistry.expandTopics).toHaveBeenCalledWith("ml");
    expect(searchExecutor.executeSearchPlan).toHaveBeenCalledTimes(1);
    expect(
      planFromFirstSearchCall(),
    ).toMatchObject({
      semanticQuery: "ml machine learning",
      keywordQuery: "ml OR machine OR learning",
      softPreferences: { topicExpansions: ["machine learning"] },
    });
    expect(result.results.length).toBe(1);
  });

  it("applies Query Language v1 power fields, quoted phrases, and dash negation", async () => {
    const query =
      'status:open online:true days:MWF time:morning term:spring-2026 "data structures" -friday';

    vi.mocked(extractor.extract).mockReturnValue({
      hints: [],
      residual: "",
    });
    vi.mocked(queryResolver.resolveQuery).mockResolvedValue({
      filters: {},
      semanticQuery: "",
      keywordQuery: "",
    });
    vi.mocked(queryResolver.parseTermValue).mockReturnValue({
      term: "spring",
      year: 2026,
    });
    mockExecution([]);
    vi.mocked(topicRegistry.expandTopics).mockReturnValue([]);

    await pipeline.search(request(query));

    expect(searchExecutor.executeSearchPlan).toHaveBeenCalledTimes(1);
    expect(
      planFromFirstSearchCall(),
    ).toMatchObject({
      filters: {
        status: "open",
        online: true,
        days: "MWF",
        time: "morning",
        term: "spring",
        year: 2026,
        not: { days: ["friday"] },
      },
      keywordQuery: '"data structures"',
      semanticQuery: "data structures",
    });
  });

  it("does not silently drop unsupported dash negation tokens", async () => {
    const query = "algorithms -calculus";

    vi.mocked(extractor.extract).mockReturnValue({
      hints: [],
      residual: "algorithms -calculus",
    });
    vi.mocked(queryResolver.resolveQuery).mockResolvedValue({
      filters: {},
      semanticQuery: "algorithms -calculus",
      keywordQuery: "algorithms -calculus",
    });
    mockExecution([]);
    vi.mocked(topicRegistry.expandTopics).mockReturnValue([]);

    await pipeline.search(request(query));

    expect(planFromFirstSearchCall()).toMatchObject({
      semanticQuery: "algorithms calculus",
      keywordQuery: "algorithms calculus",
      filters: {},
    });
  });

  it("does not relax explicit hard constraints when exact search is sparse", async () => {
    const query = "400 level CS courses with Fagen";
    const mockExtracted: ExtractionResult = {
      hints: [
        {
          type: "subject",
          value: "CS",
          metadata: { source: "regex", confidence: 0.9, raw: "CS" },
        },
        {
          type: "level",
          value: 400,
          metadata: { source: "regex", confidence: 0.9, raw: "400 level" },
        },
        {
          type: "instructor",
          value: "Fagen",
          metadata: { source: "regex", confidence: 0.9, raw: "Fagen" },
        },
      ],
      residual: "",
    };
    const mockPlan: SearchPlan = {
      filters: { subject: "CS", level: 400, instructor_ids: [123] },
      semanticQuery: "",
      keywordQuery: "",
    };

    vi.mocked(extractor.extract).mockReturnValue(mockExtracted);
    vi.mocked(queryResolver.resolveQuery).mockResolvedValue(mockPlan);
    vi.mocked(topicRegistry.expandTopics).mockReturnValue([]);

    mockExecution([]);

    await pipeline.search(request(query));

    expect(searchExecutor.executeSearchPlan).toHaveBeenCalledTimes(1);
    expect(
      planFromFirstSearchCall().filters,
    ).toMatchObject({
      subject: "CS",
      level: 400,
      instructor_ids: [123],
    });
  });

  it("plans structured advanced-search overrides without rewriting the raw query", async () => {
    vi.mocked(extractor.extract).mockReturnValue({
      hints: [],
      residual: "algorithms",
    });
    vi.mocked(queryResolver.resolveQuery).mockImplementation(
      async (_db, rawQuery, extraction) => {
        expect(rawQuery).toBe("algorithms");
        expect(extraction.hints).toEqual([]);

        return {
          filters: { instructor_ids: [123] },
          semanticQuery: "algorithms",
          keywordQuery: "algorithms",
        };
      },
    );
    vi.mocked(queryResolver.resolveInstructorIds).mockResolvedValue([123]);
    mockExecution([
      { course: mockCourse({ id: "CS-225" }), score: 1 },
    ]);

    const result = await pipeline.search(normalizeSearchRequestDto({
      query: "algorithms",
      filters: {
        subject: "CS",
        credits: 4,
        instructor: "Fagen",
      },
    }));

    expect(result.meta.query.raw).toBe("algorithms");
    expect(result.meta.extraction.hints).toEqual([]);
    expect(
      planFromFirstSearchCall().filters,
    ).toMatchObject({
      subject: "CS",
      credits: 4,
      instructor_ids: [123],
    });
  });

  it("preserves interpreted intent for over-constrained searches with no results", async () => {
    const query = "online us minority no exams no essays 8 week";

    vi.mocked(extractor.extract).mockReturnValue({
      hints: [
        {
          type: "online",
          value: true,
          metadata: { source: "alias", confidence: 0.9, raw: "online" },
        },
        {
          type: "requirement",
          value: "US",
          metadata: { source: "alias", confidence: 0.9, raw: "us minority" },
        },
      ],
      residual: "",
    });
    vi.mocked(queryResolver.resolveQuery).mockResolvedValue({
      filters: { online: true, requirement: singleRequirementFilter("US") },
      semanticQuery: "",
      keywordQuery: "",
    });
    mockExecution([]);
    vi.mocked(topicRegistry.expandTopics).mockReturnValue([]);

    const result = await pipeline.search(request(query));

    expect(result.results).toEqual([]);
    expect(result.meta.plan.intent).toMatchObject({
      queryTypes: expect.arrayContaining([
        "requirement",
        "schedule",
        "avoidance",
        "subjective_vibe",
      ]),
    });
  });
});
