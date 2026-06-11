import type { D1Database } from "@cloudflare/workers-types";
import { describe, expect, it, vi } from "vitest";
import { singleRequirementFilter } from "@uiuc-course-search/query-types";
import { countSearchCandidates } from "../search-candidate-count.js";
import { buildSearchCandidateBudget } from "../search-budget.js";
import { normalizeSearchControls } from "../search-controls.js";
import { buildRetrievalPlan } from "../search-retrieval-plan.js";

function countDb(total: number) {
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn((...params: unknown[]) => ({
      first: vi.fn(async () => ({ total })),
      sql,
      params,
    })),
  }));
  return {
    db: { prepare } as unknown as D1Database,
    prepare,
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
    const { db, prepare } = countDb(83);
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

    const sql = prepare.mock.calls[0][0];
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
});
