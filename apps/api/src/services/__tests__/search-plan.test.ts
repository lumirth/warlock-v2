import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { describe, expect, it } from "vitest";
import { createSearchPlan } from "../search-plan-compiler.js";

const subjects = [
  { id: "CS", name: "Computer Science" },
  { id: "PHIL", name: "Philosophy" },
];

const db = {
  prepare(sql: string) {
    const statement = {
      bind() { return statement; },
      async all() {
        if (sql.includes("SELECT id, name FROM subjects")) return { results: subjects };
        if (sql.includes("subject_id, alias")) return { results: [] };
        if (sql.includes("FROM instructors")) return { results: [{ id: 7 }] };
        return { results: [] };
      },
    };
    return statement as unknown as D1PreparedStatement;
  },
} as unknown as D1Database;

describe("search planning boundary", () => {
  it.each([
    ["CS 225", { subject: "CS", number: "225" }],
    ["open online MWF morning 3 credits", { status: "open", online: true, days: "MWF", time: "morning", credits: 3 }],
    ["subject:CS level:400", { subject: "CS", level: 400 }],
    ["gened:any(HUM,US)", { requirement: { mode: "any", codes: ["HUM", "US"] } }],
    ["cultural studies gened", { requirement: { mode: "single", codes: ["CS"] } }],
    ["philosphy", { subject: "PHIL" }],
    ["spring 2026 professor fagen", { term: "spring", year: 2026, instructor_ids: [7] }],
    ["no morning no friday", { not: { time: ["morning"], days: ["friday"] } }],
    ["not online", { online: false }],
    ["no exams CS", { subject: "CS", not: { keywords: ["exam"] } }],
  ] as const)("compiles %s once", async (query, expected) => {
    const result = await createSearchPlan(db, query);
    expect(result.plan.filters).toMatchObject(expected);
  });

  it("separates an introductory preference from its hard subject filter", async () => {
    const result = await createSearchPlan(db, "intro to philosophy");
    expect(result.plan.filters).toMatchObject({ subject: "PHIL" });
    expect(result.plan).toMatchObject({
      introductoryGateway: true,
      softPreferences: { levelBoost: 100 },
    });
  });

  it("consumes the user's spelling when a fuzzy subject name matches", async () => {
    const result = await createSearchPlan(db, "philosphy");
    expect(result.plan.filters.subject).toBe("PHIL");
    expect(result.residual).toBe("");
  });

  it("lets explicit request filters override interpreted text", async () => {
    const result = await createSearchPlan(db, "online CS", { online: false, level: 300 });
    expect(result.plan.filters).toMatchObject({ subject: "CS", online: false, level: 300 });
  });

  it("emits one canonical request hint for a complete term and year", async () => {
    const result = await createSearchPlan(db, "", { term: "spring", year: 2026 });
    expect(result.hints).toEqual([
      {
        type: "term",
        value: { term: "spring", year: 2026 },
        metadata: {
          source: "request",
          raw: "spring 2026",
        },
      },
    ]);
  });

  it("uses the canonical term hint for term-only requests and omits year-only hints", async () => {
    const term = await createSearchPlan(db, "", { term: "spring" });
    const year = await createSearchPlan(db, "", { year: 2026 });

    expect(term.hints).toEqual([{
      type: "term",
      value: { term: "spring" },
      metadata: { source: "request", raw: "spring" },
    }]);
    expect(year.hints).toEqual([]);
  });

  it("turns an unmatched quote into safe FTS text", async () => {
    const result = await createSearchPlan(db, '"data structures');
    expect(result.plan.keywordQuery).toBe("data structures");
  });
});
