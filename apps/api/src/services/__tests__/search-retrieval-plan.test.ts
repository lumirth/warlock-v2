import { describe, expect, it } from "vitest";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { singleRequirementFilter } from "@uiuc-course-search/query-types";
import type { SearchPlan } from "@uiuc-course-search/query-types/search-planner";
import { buildSearchCandidateBudget } from "../search-budget.js";
import { normalizeSearchControls } from "../search-controls.js";
import { buildRetrievalPlan, laneEnabled } from "../search-retrieval-plan.js";

class SubjectLookupStatement {
  private params: unknown[] = [];

  constructor(private readonly sql: string) {}

  bind(...params: unknown[]): D1PreparedStatement {
    this.params = params;
    return this as unknown as D1PreparedStatement;
  }

  async first<T>(): Promise<T | null> {
    if (this.sql.includes("SELECT id FROM subjects WHERE id = ?")) {
      const subject = String(this.params[0] ?? "").toUpperCase();
      return subject === "CS" ? ({ id: "CS" } as T) : null;
    }
    return null;
  }
}

function db(): D1Database {
  return {
    prepare(sql: string): D1PreparedStatement {
      return new SubjectLookupStatement(sql) as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
}

function plan(overrides: Partial<SearchPlan> = {}): SearchPlan {
  return {
    filters: {},
    keywordQuery: "",
    semanticQuery: "",
    ...overrides,
  };
}

async function retrievalPlan(searchPlan: SearchPlan) {
  const controls = normalizeSearchControls();
  const budget = buildSearchCandidateBudget(
    searchPlan,
    { limit: 10, offset: 0 },
    controls,
  );
  return buildRetrievalPlan(db(), searchPlan, controls, budget);
}

describe("buildRetrievalPlan", () => {
  it("uses the exact lane for course-code lookups and suppresses semantic retrieval", async () => {
    const result = await retrievalPlan(
      plan({
        filters: { subject: "CS", number: "225" },
      }),
    );

    expect(laneEnabled(result, "exact")).toBe(true);
    expect(laneEnabled(result, "official_text")).toBe(false);
    expect(laneEnabled(result, "topic_semantic")).toBe(false);
    expect(result.isNavigational).toBe(true);
  });

  it("keeps section text search distinct from structured section constraints", async () => {
    const result = await retrievalPlan(
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

  it("enables structured section retrieval only for structured section filters or preferences", async () => {
    const result = await retrievalPlan(
      plan({
        filters: { online: true },
      }),
    );

    expect(laneEnabled(result, "section_text")).toBe(false);
    expect(laneEnabled(result, "structured_section")).toBe(true);
  });

  it("does not execute the requirement lane for requirement-like intent without a concrete requirement filter", async () => {
    const result = await retrievalPlan(
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

  it("executes the requirement lane when the plan has a concrete requirement filter", async () => {
    const result = await retrievalPlan(
      plan({
        filters: { requirement: singleRequirementFilter("HUM") },
      }),
    );

    expect(laneEnabled(result, "requirement")).toBe(true);
  });

  it("records workload evidence signal types as part of executable retrieval configuration", async () => {
    const result = await retrievalPlan(
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

  it("resolves a bare subject keyword once and exposes the effective plan separately from the input plan", async () => {
    const input = plan({
      keywordQuery: "cs",
      semanticQuery: "cs",
    });
    const result = await retrievalPlan(input);

    expect(input.filters.subject).toBeUndefined();
    expect(result.effectivePlan.filters.subject).toBe("CS");
    expect(result.inputPlan.filters.subject).toBeUndefined();
  });
});
