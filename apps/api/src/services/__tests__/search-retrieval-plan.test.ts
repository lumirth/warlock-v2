import { describe, expect, it } from "vitest";
import { singleRequirementFilter } from "@uiuc-course-search/query-types";
import type { SearchPlan } from "../search-planner-types.js";
import { buildSearchCandidateBudget } from "../search-budget.js";
import { normalizeSearchControls } from "../search-controls.js";
import { buildRetrievalPlan, type RetrievalPlan } from "../search-retrieval-plan.js";

function hasLane(plan: RetrievalPlan, lane: RetrievalPlan["lanes"][number]["lane"]): boolean {
  return plan.lanes.some((candidate) => candidate.lane === lane);
}

function plan(overrides: Partial<SearchPlan> = {}): SearchPlan {
  return {
    filters: {},
    keywordQuery: "",
    semanticQuery: "",
    ...overrides,
  };
}

function retrievalPlan(
  searchPlan: SearchPlan,
  controls = normalizeSearchControls(),
  currentTermIds: string[] = [],
) {
  const budget = buildSearchCandidateBudget();
  return buildRetrievalPlan(searchPlan, controls, budget, currentTermIds);
}

describe("buildRetrievalPlan", () => {
  it("uses the exact lane for course-code lookups and suppresses semantic retrieval", () => {
    const result = retrievalPlan(
      plan({
        filters: { subject: "CS", number: "225" },
      }),
    );

    expect(hasLane(result, "exact")).toBe(true);
    expect(hasLane(result, "official_text")).toBe(false);
    expect(hasLane(result, "structured_course")).toBe(false);
    expect(hasLane(result, "topic_semantic")).toBe(false);
  });

  it("keeps section text search distinct from filter-only structured recall", () => {
    const result = retrievalPlan(
      plan({
        keywordQuery: "movies",
        semanticQuery: "movies",
      }),
    );

    expect(hasLane(result, "official_text")).toBe(true);
    expect(hasLane(result, "section_text")).toBe(true);
    expect(hasLane(result, "topic_semantic")).toBe(true);
  });

  it("uses one structured recall lane for hard section filters", () => {
    const result = retrievalPlan(
      plan({
        filters: { online: true },
      }),
    );

    expect(hasLane(result, "section_text")).toBe(false);
    expect(hasLane(result, "structured_course")).toBe(true);
  });

  it("uses structured course recall instead of pretending filter-only search is official text", () => {
    const result = retrievalPlan(plan({ filters: { subject: "CS" } }));

    expect(hasLane(result, "structured_course")).toBe(true);
    expect(hasLane(result, "official_text")).toBe(false);
  });

  it("pushes active scope into executable retrieval unless the request names a term", () => {
    const active = retrievalPlan(plan({ filters: { subject: "CS" } }));
    const explicitTerm = retrievalPlan(
      plan({ filters: { subject: "CS", year: 2025, term: "fall" } }),
    );

    expect(active.inputs.scope).toBe("active");
    expect(explicitTerm.inputs.scope).toBe("all");
  });

  it("keeps all-scope retrieval exhaustive across historical terms", () => {
    const result = retrievalPlan(
      plan({ filters: { subject: "CS" } }),
      normalizeSearchControls({ scope: "all" }),
    );

    expect(result.inputs.scope).toBe("all");
    expect(result.inputs.semanticTermIds).toEqual([]);
  });

  it("pre-filters semantic recall to current or explicitly requested terms", () => {
    const active = retrievalPlan(
      plan({ semanticQuery: "machine learning" }),
      normalizeSearchControls(),
      ["2026-fall", "2027-spring"],
    );
    const explicit = retrievalPlan(
      plan({
        semanticQuery: "machine learning",
        filters: { year: 2025, term: "fall" },
      }),
      normalizeSearchControls(),
      ["2026-fall"],
    );

    expect(active.inputs.semanticTermIds).toEqual(["2026-fall", "2027-spring"]);
    expect(explicit.inputs.semanticTermIds).toEqual(["2025-fall"]);
  });

  it("executes structured recall for explicit compressed-term and time constraints", () => {
    const result = retrievalPlan(
      plan({
        filters: {
          compressedTerm: true,
          startAfterMinutes: 600,
        },
      }),
    );

    expect(result.lanes.map((lane) => lane.lane)).toEqual(["structured_course"]);
  });

  it("does not create duplicate recall lanes for requirement-like intent", () => {
    const result = retrievalPlan(
      plan({
        filters: { subject: "CS" },
        intent: {
          queryTypes: ["requirement"],
          negativeTerms: [],
          topicTerms: [],
          expandedTerms: [],
          warnings: [],
          confidence: 0.72,
        },
      }),
    );

    expect(result.lanes.map((lane) => lane.lane)).toEqual(["structured_course"]);
  });

  it("treats a concrete requirement as a hard constraint on structured recall", () => {
    const result = retrievalPlan(
      plan({
        filters: { requirement: singleRequirementFilter("HUM") },
      }),
    );

    expect(result.lanes.map((lane) => lane.lane)).toEqual(["structured_course"]);
  });

  it("does not invent an executable lane for soft preferences without backing data", () => {
    const result = retrievalPlan(
      plan({
        softPreferences: { lowWriting: 0.8, lowMath: 0.7 },
      }),
    );

    expect(result.lanes.map((lane) => lane.lane)).toEqual(["structured_course"]);
  });

  it("consumes the compiled plan without resolving bare keyword text into new filters", () => {
    const input = plan({
      keywordQuery: "cs",
      semanticQuery: "cs",
    });
    const result = retrievalPlan(input);

    expect(input.filters.subject).toBeUndefined();
    expect(result.inputs.filters.subject).toBeUndefined();
    expect(result.inputs.keywordQuery).toBe("cs");
    expect(result.inputs.semanticQuery).toBe("cs");
  });
});
