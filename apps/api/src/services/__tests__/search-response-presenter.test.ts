import { describe, expect, it } from "vitest";
import { normalizeSearchRequestDto } from "@uiuc-course-search/query-types";
import type { Course } from "../../db/types.js";
import { buildSearchCandidateBudget } from "../search-budget.js";
import type { SearchPipelineResult } from "../search-pipeline-result.js";
import { presentSearchResponse } from "../search-response-presenter.js";

describe("presentSearchResponse", () => {
  it("separates the executable continuation from the interpreted display request", () => {
    const response = presentSearchResponse({
      request: normalizeSearchRequestDto({ query: "highest gpa classes" }),
      pagination: { limit: 20, offset: 0 },
      result: pipelineResult({
        rawQuery: "highest gpa classes",
        residual: "",
        sort: { field: "gpa", direction: "desc" },
        plan: {
          filters: {},
          semanticQuery: "",
          keywordQuery: "",
          softPreferences: {
            inferredSort: { field: "gpa", direction: "desc" },
          },
        },
      }),
    });

    expect(response.meta.nextRequest).toEqual({
      query: "highest gpa classes",
      filters: {},
      sort: { field: "gpa", direction: "desc" },
      scope: "active",
    });
    expect(response.meta.interpretedRequest).toEqual({
      query: "",
      filters: undefined,
      sort: { field: "gpa", direction: "desc" },
      scope: "active",
    });
    expect(response.meta).not.toHaveProperty("plan");
    expect(response.meta).not.toHaveProperty("extraction");
  });

  it("presents an exact total separately from the bounded ranked result window", () => {
    const results = Array.from({ length: 16 }, (_, index) => ({
      course: course({ id: `CS-${index}-2026-spring`, number: String(100 + index) }),
      score: 1 - index / 100,
    }));
    const response = presentSearchResponse({
      request: normalizeSearchRequestDto({ query: "intro to CS" }),
      pagination: { limit: 5, offset: 10 },
      result: {
        ...pipelineResult({ rawQuery: "intro to CS", results }),
        totalResults: 42,
      },
    });

    expect(response.results.map((result) => result.course.id)).toEqual([
      "CS-10-2026-spring",
      "CS-11-2026-spring",
      "CS-12-2026-spring",
      "CS-13-2026-spring",
      "CS-14-2026-spring",
    ]);
    expect(response.pagination).toEqual({
      totalResults: 42,
      browseableResults: 16,
      limit: 5,
      offset: 10,
      hasMore: true,
      nextOffset: 15,
    });
  });
});

function pipelineResult(input: {
  rawQuery?: string;
  residual?: string;
  results?: SearchPipelineResult["results"];
  sort?: SearchPipelineResult["meta"]["retrievalPlan"]["controls"]["sort"];
  plan?: SearchPipelineResult["meta"]["plan"];
} = {}): SearchPipelineResult {
  const rawQuery = input.rawQuery ?? "";
  const residual = input.residual ?? rawQuery;
  const plan = input.plan ?? {
    filters: {},
    semanticQuery: residual,
    keywordQuery: residual,
  };
  const results = input.results ?? [];
  const sort = input.sort ?? { field: "relevance", direction: "desc" };
  const budget = buildSearchCandidateBudget();

  return {
    results,
    totalResults: results.length,
    meta: {
      query: { raw: rawQuery, residual },
      extraction: { hints: [] },
      compilerEvents: [],
      plan,
      retrievalPlan: {
        controls: { sort, scope: "active" },
        budget,
        lanes: [],
        inputs: {
          filters: plan.filters,
          keywordQuery: plan.keywordQuery,
          cleanKeywordQuery: plan.keywordQuery,
          titleQuery: plan.keywordQuery,
          semanticQuery: plan.semanticQuery,
          scope: "active",
          semanticTermIds: [],
        },
      },
      retrievalExecution: {
        successfulLanes: [],
        failedLanes: [],
      },
    },
  };
}

function course(overrides: Partial<Course> = {}): Course {
  return {
    id: "CS-225-2026-spring",
    subject: "CS",
    number: "225",
    title: "Data Structures",
    description: "Data structures and algorithms.",
    credit_hours: 4,
    year: 2026,
    term: "spring",
    avg_gpa: 3.4,
    gpa_sample_size: 100,
    primary_instructor: "Ada Lovelace",
    primary_instructor_rmp: null,
    difficulty_score: 42,
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
  };
}
