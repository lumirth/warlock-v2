import { describe, it, expect, vi, beforeEach } from "vitest";
import { singleRequirementFilter } from "@uiuc-course-search/query-types";
import { SearchPipeline } from "../search-pipeline.js";
import { buildSearchCandidateBudget } from "../search-budget.js";
import { normalizeSearchControls } from "../search-controls.js";
import type { D1Database, VectorizeIndex, Ai } from "@cloudflare/workers-types";
import * as extractor from "../extractor.js";
import * as queryResolver from "../query-resolver.js";
import * as searchText from "../search-text.js";
import * as termRanking from "../search-term-ranking.js";
import * as topicRegistry from "../topic-registry.js";
import { normalizeSearchRequest } from "../search-request.js";
import type { Course } from "../../db/index.js";
import type { ExtractionResult } from "../extractor.js";
import type { SearchResult } from "../search.js";
import type { SearchPlan } from "@uiuc-course-search/query-types/search-planner";

vi.mock("../extractor.js");
vi.mock("../query-resolver.js");
vi.mock("../search-text.js");
vi.mock("../search-term-ranking.js");
vi.mock("../topic-registry.js");

function request(query: string, filters = {}) {
  return normalizeSearchRequest({ query, filters });
}

function planFromFirstSearchCall(): SearchPlan {
  return vi.mocked(termRanking.hybridSearchWithTermRanking).mock.calls[0][3]
    .plan;
}

const mockCourse = (overrides: Partial<Course> = {}): Course => ({
  id: "CS-225-2025-fall",
  subject: "CS",
  number: "225",
  title: "Data Structures",
  description: "Data structures and algorithms.",
  credit_hours: 4,
  gened: "QR",
  year: 2025,
  term: "fall",
  avg_gpa: 3.5,
  gpa_sample_size: 1000,
  primary_instructor: "Fagen-Ulmschneider, G",
  primary_instructor_rmp: 4.5,
  difficulty_score: 3.0,
  quality_score: 4.5,
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
    vi.mocked(searchText.sanitizeFtsQuery).mockImplementation((queryText) => queryText);
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

    vi.mocked(extractor.extractQuery).mockReturnValue(mockExtracted);
    vi.mocked(queryResolver.resolveQuery).mockResolvedValue(mockPlan);
    vi.mocked(termRanking.hybridSearchWithTermRanking).mockResolvedValue(
      mockResults,
    );

    const result = await pipeline.search(request(query));

    expect(result.results).toEqual(mockResults);
    expect(termRanking.hybridSearchWithTermRanking).toHaveBeenCalledTimes(1);
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

    vi.mocked(extractor.extractQuery).mockReturnValue(mockExtracted);
    vi.mocked(queryResolver.resolveQuery).mockResolvedValue(mockPlan);
    vi.mocked(termRanking.hybridSearchWithTermRanking).mockResolvedValue(
      mockResults,
    );

    const result = await pipeline.search(request(query));

    expect(result.results).toEqual(mockResults);
    expect(termRanking.hybridSearchWithTermRanking).toHaveBeenCalledTimes(1);
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

    vi.mocked(extractor.extractQuery).mockReturnValue(mockExtracted);
    vi.mocked(queryResolver.resolveQuery).mockResolvedValue(mockPlan);
    vi.mocked(searchText.sanitizeFtsQuery).mockImplementation(
      (queryText) => queryText,
    );
    vi.mocked(termRanking.hybridSearchWithTermRanking).mockResolvedValue(
      mockResults,
    );

    const result = await pipeline.search(request(query), { limit: 5 });

    expect(planFromFirstSearchCall()).toMatchObject({
        intents: ["introductory_gateway"],
        softPreferences: { levelBoost: 100, introductoryIntent: "gateway" },
    });
    expect(
      vi.mocked(termRanking.hybridSearchWithTermRanking).mock.calls[0][3].budget
        .executionResultLimit,
    ).toBe(40);
    expect(result.results).toHaveLength(40);
  });

  it("keeps ordinary relevance searches near the requested page window", () => {
    const plan = { filters: {}, semanticQuery: "systems", keywordQuery: "systems" };
    const controls = normalizeSearchControls();

    expect(
      buildSearchCandidateBudget(plan, { limit: 5, offset: 0 }, controls)
        .executionResultLimit,
    ).toBe(10);
  });

  it("infers attribute sort intent from superlative queries and widens candidates", async () => {
    const query = "highest gpa classes";
    vi.mocked(extractor.extractQuery).mockReturnValue({
      hints: [],
      residual: "highest gpa",
    });
    vi.mocked(queryResolver.resolveQuery).mockResolvedValue({
      filters: {},
      semanticQuery: "highest gpa",
      keywordQuery: "highest gpa",
    });
    vi.mocked(searchText.sanitizeFtsQuery).mockImplementation(
      (queryText) => queryText,
    );
    vi.mocked(termRanking.hybridSearchWithTermRanking).mockResolvedValue([
      { course: mockCourse({ id: "LOW", avg_gpa: 3.1 }), score: 2 },
      { course: mockCourse({ id: "HIGH", avg_gpa: 3.9 }), score: 1 },
    ]);

    const result = await pipeline.search(request(query), { limit: 1 });

    expect(planFromFirstSearchCall()).toMatchObject({
        keywordQuery: "",
        semanticQuery: "",
        softPreferences: expect.objectContaining({
          inferredSort: { field: "gpa", direction: "desc" },
        }),
    });
    expect(
      vi.mocked(termRanking.hybridSearchWithTermRanking).mock.calls[0][3].budget
        .executionResultLimit,
    ).toBe(1200);
    expect(result.meta.appliedSort).toEqual({ field: "gpa", direction: "desc" });
    expect(result.results[0].course.id).toBe("HIGH");
  });

  it("infers explicit sort-by commands without leaving sort words in the residual query", async () => {
    const query = "sort by difficulty";
    vi.mocked(extractor.extractQuery).mockReturnValue({
      hints: [],
      residual: "sort by difficulty",
    });
    vi.mocked(queryResolver.resolveQuery).mockResolvedValue({
      filters: {},
      semanticQuery: "sort by difficulty",
      keywordQuery: "sort by difficulty",
    });
    vi.mocked(searchText.sanitizeFtsQuery).mockImplementation(
      (queryText) => queryText,
    );
    vi.mocked(termRanking.hybridSearchWithTermRanking).mockResolvedValue([
      { course: mockCourse({ id: "HARD", difficulty_score: 82 }), score: 2 },
      { course: mockCourse({ id: "EASY", difficulty_score: 12 }), score: 1 },
    ]);

    const result = await pipeline.search(request(query), { limit: 1 });

    expect(planFromFirstSearchCall()).toMatchObject({
        keywordQuery: "",
        semanticQuery: "",
        softPreferences: expect.objectContaining({
          inferredSort: { field: "workload", direction: "asc" },
        }),
    });
    expect(
      vi.mocked(termRanking.hybridSearchWithTermRanking).mock.calls[0][3].budget
        .executionResultLimit,
    ).toBe(1200);
    expect(result.meta.appliedSort).toEqual({ field: "workload", direction: "asc" });
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

    vi.mocked(extractor.extractQuery).mockReturnValue(mockExtracted);
    vi.mocked(queryResolver.resolveQuery).mockResolvedValue(mockPlan);
    vi.mocked(searchText.sanitizeFtsQuery).mockImplementation(
      (queryText) => queryText,
    );
    vi.mocked(topicRegistry.expandTopics).mockReturnValue(["machine learning"]);

    vi.mocked(termRanking.hybridSearchWithTermRanking).mockResolvedValueOnce([
      { course: mockCourse({ id: "1" }), score: 0.5 },
    ]);

    const result = await pipeline.search(request(query));

    expect(topicRegistry.expandTopics).toHaveBeenCalledWith("ml");
    expect(termRanking.hybridSearchWithTermRanking).toHaveBeenCalledTimes(1);
    expect(
      planFromFirstSearchCall(),
    ).toMatchObject({
      semanticQuery: "ml machine learning",
      keywordQuery: "ml OR machine OR learning",
      softPreferences: { topicExpansions: ["machine learning"] },
    });
    expect(result.results.length).toBe(1);
  });

  it("exposes each retrieval plan when sparse results trigger expansion", async () => {
    const query = "ml courses";
    vi.mocked(extractor.extractQuery).mockReturnValue({
      hints: [],
      residual: "ml",
    });
    vi.mocked(queryResolver.resolveQuery).mockResolvedValue({
      filters: {},
      semanticQuery: "ml",
      keywordQuery: "ml",
    });
    vi.mocked(searchText.sanitizeFtsQuery).mockImplementation(
      (queryText) => queryText,
    );
    vi.mocked(topicRegistry.expandTopics)
      .mockReturnValueOnce([])
      .mockReturnValueOnce(["machine learning"]);
    vi.mocked(termRanking.hybridSearchWithTermRanking)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { course: mockCourse({ id: "expanded" }), score: 0.8 },
      ]);

    const result = await pipeline.search(request(query));

    expect(termRanking.hybridSearchWithTermRanking).toHaveBeenCalledTimes(2);
    expect(result.meta.retrievalPlans).toHaveLength(2);
    expect(result.meta.retrievalPlans[0].plan.keywordQuery).toBe("ml");
    expect(result.meta.retrievalPlans[1].plan.keywordQuery).toBe(
      "ml machine learning",
    );
    expect(Object.isFrozen(result.meta.retrievalPlans[0].plan)).toBe(true);
    expect(Object.isFrozen(result.meta.retrievalPlans[1].plan)).toBe(true);
    expect(result.results[0].course.id).toBe("expanded");
  });

  it("applies Query Language v1 power fields, quoted phrases, and dash negation", async () => {
    const query =
      'status:open online:true days:MWF time:morning term:spring-2026 "data structures" -friday';

    vi.mocked(extractor.extractQuery).mockReturnValue({
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
    vi.mocked(searchText.sanitizeFtsQuery).mockImplementation((query) => query);
    vi.mocked(termRanking.hybridSearchWithTermRanking).mockResolvedValue([]);
    vi.mocked(topicRegistry.expandTopics).mockReturnValue([]);

    await pipeline.search(request(query));

    expect(termRanking.hybridSearchWithTermRanking).toHaveBeenCalledTimes(1);
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

    vi.mocked(extractor.extractQuery).mockReturnValue({
      hints: [],
      residual: "algorithms -calculus",
    });
    vi.mocked(queryResolver.resolveQuery).mockResolvedValue({
      filters: {},
      semanticQuery: "algorithms -calculus",
      keywordQuery: "algorithms -calculus",
    });
    vi.mocked(searchText.sanitizeFtsQuery).mockImplementation(
      (queryText) => queryText,
    );
    vi.mocked(termRanking.hybridSearchWithTermRanking).mockResolvedValue([]);
    vi.mocked(topicRegistry.expandTopics).mockReturnValue([]);

    await pipeline.search(request(query));

    expect(planFromFirstSearchCall()).toMatchObject({
        semanticQuery: "algorithms -calculus",
        keywordQuery: "algorithms -calculus",
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
    const mockPlan = {
      filters: { subject: "CS", level: 400, instructor_ids: [123] },
      semanticQuery: "",
      keywordQuery: "",
    };

    vi.mocked(extractor.extractQuery).mockReturnValue(mockExtracted);
    vi.mocked(queryResolver.resolveQuery).mockResolvedValue(mockPlan);
    vi.mocked(topicRegistry.expandTopics).mockReturnValue([]);

    vi.mocked(termRanking.hybridSearchWithTermRanking).mockResolvedValueOnce([]);

    const result = await pipeline.search(request(query));

    expect(result.meta.fallback).toBeDefined();
    expect(result.meta.fallback.tierReached).toBe(2);
    expect(result.meta.fallback.constraintsRelaxed).toEqual([]);
    expect(termRanking.hybridSearchWithTermRanking).toHaveBeenCalledTimes(1);
    expect(
      planFromFirstSearchCall().filters,
    ).toMatchObject({
      subject: "CS",
      level: 400,
      instructor_ids: [123],
    });
  });

  it("plans structured advanced-search overrides without rewriting the raw query", async () => {
    vi.mocked(extractor.extractQuery).mockReturnValue({
      hints: [],
      residual: "algorithms",
    });
    vi.mocked(queryResolver.resolveQuery).mockImplementation(
      async (_db, extracted) => {
        expect(extracted.rawQuery).toBe("algorithms");
        expect(extracted.hints).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ type: "subject", value: "CS" }),
            expect.objectContaining({ type: "credits", value: 4 }),
            expect.objectContaining({ type: "instructor", value: "Fagen" }),
          ]),
        );

        return {
          filters: { instructor_ids: [123] },
          semanticQuery: "algorithms",
          keywordQuery: "algorithms",
        };
      },
    );
    vi.mocked(termRanking.hybridSearchWithTermRanking).mockResolvedValue([
      { course: mockCourse({ id: "CS-225" }), score: 1 },
    ]);

    const result = await pipeline.search(normalizeSearchRequest({
      query: "algorithms",
      filters: {
        subject: "CS",
        credits: 4,
        instructor: "Fagen",
      },
    }), { limit: 20 });

    expect(result.meta.query.raw).toBe("algorithms");
    expect(result.meta.extraction.hints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "subject",
          value: "CS",
          metadata: expect.objectContaining({ source: "manual" }),
        }),
        expect.objectContaining({
          type: "instructor",
          value: "Fagen",
          metadata: expect.objectContaining({ source: "manual" }),
        }),
      ]),
    );
    expect(
      planFromFirstSearchCall().filters,
    ).toMatchObject({
      subject: "CS",
      credits: 4,
      instructor_ids: [123],
    });
  });

  it("returns recovery groups for over-constrained decision searches with no results", async () => {
    const query = "online us minority no exams no essays 8 week";

    vi.mocked(extractor.extractQuery).mockReturnValue({
      hints: [
        {
          type: "online",
          value: true,
          metadata: { source: "alias", confidence: 0.9, raw: "online" },
        },
        {
          type: "gened",
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
    vi.mocked(searchText.sanitizeFtsQuery).mockImplementation(
      (queryText) => queryText,
    );
    vi.mocked(termRanking.hybridSearchWithTermRanking).mockResolvedValue([]);
    vi.mocked(topicRegistry.expandTopics).mockReturnValue([]);

    const result = await pipeline.search(request(query));

    expect(result.results).toEqual([]);
    expect(result.meta.plan.rescue).toMatchObject({
      queryTypes: expect.arrayContaining([
        "requirement",
        "schedule",
        "avoidance",
        "subjective_vibe",
      ]),
      relaxationPlan: expect.arrayContaining([
        expect.objectContaining({ id: "evidence-backed-workload" }),
        expect.objectContaining({ id: "any-delivery" }),
        expect.objectContaining({ id: "adjacent-requirements" }),
      ]),
    });
    expect(result.meta.fallback.recoveryGroups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "evidence-backed-workload" }),
        expect.objectContaining({ id: "any-delivery" }),
      ]),
    );
  });
});
