import { describe, expect, it } from "vitest";
import { singleRequirementFilter } from "@uiuc-course-search/query-types";
import type { SearchPlan } from "../search-planner-types.js";
import { buildSearchCandidateBudget } from "../search-budget.js";
import { normalizeSearchControls } from "../search-controls.js";
import { buildRetrievalPlan, laneEnabled } from "../search-retrieval-plan.js";

function plan(overrides: Partial<SearchPlan> = {}): SearchPlan {
  return {
    filters: {},
    keywordQuery: "",
    semanticQuery: "",
    ...overrides,
  };
}

function retrievalPlan(searchPlan: SearchPlan) {
  const controls = normalizeSearchControls();
  const budget = buildSearchCandidateBudget(
    searchPlan,
    { limit: 10, offset: 0 },
    controls,
  );
  return buildRetrievalPlan(searchPlan, controls, budget);
}

describe("buildRetrievalPlan", () => {
  it("uses the exact lane for course-code lookups and suppresses semantic retrieval", () => {
    const result = retrievalPlan(
      plan({
        filters: { subject: "CS", number: "225" },
      }),
    );

    expect(laneEnabled(result, "exact")).toBe(true);
    expect(laneEnabled(result, "official_text")).toBe(false);
    expect(laneEnabled(result, "topic_semantic")).toBe(false);
    expect(result.isNavigational).toBe(true);
  });

  it("keeps section text search distinct from structured section constraints", () => {
    const result = retrievalPlan(
      plan({
        keywordQuery: "movies",
        semanticQuery: "movies",
      }),
    );

    expect(laneEnabled(result, "official_text")).toBe(true);
    expect(laneEnabled(result, "section_text")).toBe(true);
    expect(laneEnabled(result, "structured_section")).toBe(false);
    expect(laneEnabled(result, "topic_semantic")).toBe(true);
  });

  it("enables structured section retrieval only for structured section filters or preferences", () => {
    const result = retrievalPlan(
      plan({
        filters: { online: true },
      }),
    );

    expect(laneEnabled(result, "section_text")).toBe(false);
    expect(laneEnabled(result, "structured_section")).toBe(true);
  });

  it("does not execute the requirement lane for requirement-like intent without a concrete requirement filter", () => {
    const result = retrievalPlan(
      plan({
        filters: { subject: "CS" },
        rescue: {
          queryTypes: ["requirement"],
          negativeTerms: [],
          topicTerms: [],
          expandedTerms: [],
          assumptions: [],
          warnings: [],
          interpretedLanes: ["requirement"],
          relaxationPlan: [],
          needsStudentProfile: false,
          confidence: 0.72,
        },
      }),
    );

    expect(laneEnabled(result, "requirement")).toBe(false);
  });

  it("executes the requirement lane when the plan has a concrete requirement filter", () => {
    const result = retrievalPlan(
      plan({
        filters: { requirement: singleRequirementFilter("HUM") },
      }),
    );

    expect(laneEnabled(result, "requirement")).toBe(true);
  });

  it("records workload evidence signal types as part of executable retrieval configuration", () => {
    const result = retrievalPlan(
      plan({
        softPreferences: { lowWriting: 0.8, lowMath: 0.7 },
      }),
    );

    expect(laneEnabled(result, "workload_evidence")).toBe(true);
    expect(result.workloadSignalTypes).toEqual([
      "low_writing",
      "writing_light",
      "few_papers",
      "low_math",
      "non_quantitative",
      "non_major_friendly",
    ]);
  });

  it("consumes the compiled plan without resolving bare keyword text into new filters", () => {
    const input = plan({
      keywordQuery: "cs",
      semanticQuery: "cs",
    });
    const result = retrievalPlan(input);

    expect(input.filters.subject).toBeUndefined();
    expect(result.plan).toBe(input);
    expect(result.plan.filters.subject).toBeUndefined();
  });
});
