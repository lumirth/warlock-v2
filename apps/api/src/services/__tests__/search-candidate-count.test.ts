import type { D1Database } from "@cloudflare/workers-types";
import { describe, expect, it, vi } from "vitest";
import { singleRequirementFilter } from "@uiuc-course-search/query-types";
import { countSearchCandidates } from "../search-candidate-count.js";
import { buildSearchCandidateBudget } from "../search-budget.js";
import { normalizeSearchControls } from "../search-controls.js";
import { buildRetrievalPlan } from "../search-retrieval-plan.js";

function countDb(totals: number | number[]) {
  const values = Array.isArray(totals) ? totals : [totals];
  let callIndex = 0;
  const bindings: unknown[][] = [];
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn((...params: unknown[]) => {
      bindings.push(params);
      return {
        first: vi.fn(async () => ({ total: values[callIndex++] })),
        sql,
        params,
      };
    }),
  }));
  return {
    db: { prepare } as unknown as D1Database,
    prepare,
    bindings,
  };
}

describe("countSearchCandidates", () => {
  it("counts the complete structured match set without a browse limit", async () => {
    const { db, prepare } = countDb(451);
    const retrievalPlan = buildRetrievalPlan(
      {
        filters: {
          subject: "CS",
          requirement: singleRequirementFilter("QR"),
        },
        keywordQuery: "",
        semanticQuery: "",
      },
      normalizeSearchControls(),
      buildSearchCandidateBudget(20),
    );

    await expect(countSearchCandidates(
      db,
      retrievalPlan,
      {
        laneResults: [],
        successfulLanes: ["structured_course"],
        failedLanes: [],
      },
    )).resolves.toBe(451);

    const sql = prepare.mock.calls[0][0];
    expect(sql).toContain("COUNT(DISTINCT id)");
    expect(sql).toContain("c.subject = ?");
    expect(sql).toContain("cg.category_id = ?");
    expect(sql).not.toContain("LIMIT");
  });

  it("counts the union of official text, section text, and concrete semantic matches", async () => {
    const { db, prepare } = countDb([82, 0]);
    const retrievalPlan = buildRetrievalPlan(
      {
        filters: {},
        keywordQuery: "data structures",
        semanticQuery: "data structures",
      },
      normalizeSearchControls({ scope: "all" }),
      buildSearchCandidateBudget(20),
    );

    await expect(countSearchCandidates(
      db,
      retrievalPlan,
      {
        laneResults: [
          {
            id: "CS-225-2026-spring",
            lane: "topic_semantic",
            rank: 1,
            reason: "Semantic topic recall.",
          },
        ],
        successfulLanes: ["official_text", "section_text", "topic_semantic"],
        failedLanes: [],
      },
    )).resolves.toBe(83);

    const sql = prepare.mock.calls.map(([statement]) => statement).join("\n");
    expect(sql).toContain("FROM courses_fts");
    expect(sql).toContain("FROM sections_fts");
    expect(sql).toContain("LOWER(c.title) LIKE");
    expect(sql).toContain("SELECT ? AS id");
    expect(sql).not.toContain("LIMIT");
  });

  it("counts only lanes that completed successfully", async () => {
    const { db, prepare } = countDb(19);
    const retrievalPlan = buildRetrievalPlan(
      {
        filters: {},
        keywordQuery: "easy ai",
        semanticQuery: "easy ai",
      },
      normalizeSearchControls({ scope: "all" }),
      buildSearchCandidateBudget(20),
    );

    await expect(countSearchCandidates(
      db,
      retrievalPlan,
      {
        laneResults: [],
        successfulLanes: ["official_text"],
        failedLanes: ["section_text", "topic_semantic"],
      },
    )).resolves.toBe(19);

    const sql = prepare.mock.calls[0][0];
    expect(sql).toContain("FROM courses_fts");
    expect(sql).not.toContain("FROM sections_fts");
  });

  it("keeps every D1 count statement within the binding limit", async () => {
    const { db, bindings } = countDb([50, 20, 10]);
    const retrievalPlan = buildRetrievalPlan(
      {
        filters: { subject: "CS" },
        keywordQuery: "data structures",
        semanticQuery: "data structures",
      },
      normalizeSearchControls({ scope: "all" }),
      buildSearchCandidateBudget(20),
    );
    const laneResults = Array.from({ length: 100 }, (_, index) => ({
      id: `CS-${100 + index}-2026-spring`,
      lane: "topic_semantic" as const,
      rank: index + 1,
      reason: "Semantic topic recall.",
    }));

    await expect(countSearchCandidates(
      db,
      retrievalPlan,
      {
        laneResults,
        successfulLanes: ["official_text", "section_text", "topic_semantic"],
        failedLanes: [],
      },
    )).resolves.toBe(120);

    expect(bindings.length).toBeGreaterThan(1);
    expect(Math.max(...bindings.map((params) => params.length)))
      .toBeLessThanOrEqual(100);
  });
});
