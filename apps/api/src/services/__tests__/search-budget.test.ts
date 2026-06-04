import { describe, expect, it } from "vitest";
import type { SearchPlan } from "../search-planner-types.js";
import { buildSearchCandidateBudget } from "../search-budget.js";
import { normalizeSearchControls } from "../search-controls.js";

function plan(overrides: Partial<SearchPlan> = {}): SearchPlan {
  return {
    filters: {},
    keywordQuery: "",
    semanticQuery: "",
    ...overrides,
  };
}

describe("buildSearchCandidateBudget", () => {
  it("keeps ordinary relevance requests close to the page window", () => {
    const budget = buildSearchCandidateBudget(
      plan(),
      { limit: 10, offset: 20 },
      normalizeSearchControls(),
    );

    expect(budget.executionResultLimit).toBe(60);
    expect(budget.termCandidateLimit).toBe(120);
    expect(budget.laneCandidateLimit).toBe(120);
    expect(budget.reasons).toEqual(["relevance_page_window"]);
  });

  it("uses the full bounded candidate window for attribute sorts", () => {
    const budget = buildSearchCandidateBudget(
      plan(),
      { limit: 10, offset: 0 },
      normalizeSearchControls({ sort: { field: "gpa" } }),
      300,
    );

    expect(budget.executionResultLimit).toBe(300);
    expect(budget.termCandidateLimit).toBe(600);
    expect(budget.laneCandidateLimit).toBe(600);
    expect(budget.reasons).toEqual(["attribute_sort_full_window"]);
  });

  it("makes the introductory gateway minimum explicit", () => {
    const budget = buildSearchCandidateBudget(
      plan({ intents: ["introductory_gateway"] }),
      { limit: 5, offset: 0 },
      normalizeSearchControls(),
    );

    expect(budget.executionResultLimit).toBe(40);
    expect(budget.reasons).toEqual([
      "relevance_page_window",
      "introductory_gateway_minimum",
    ]);
  });

  it("keeps every lane above the minimum candidate floor", () => {
    const budget = buildSearchCandidateBudget(
      plan(),
      { limit: 1, offset: 0 },
      normalizeSearchControls(),
    );

    expect(budget.executionResultLimit).toBe(2);
    expect(budget.termCandidateLimit).toBe(4);
    expect(budget.laneCandidateLimit).toBe(50);
  });
});
