import { describe, expect, it } from "vitest";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { createSearchPlan } from "../search-plan-compiler.js";
import { buildSearchCandidateBudget } from "../search-budget.js";
import { normalizeSearchControls } from "../search-controls.js";
import { buildRetrievalPlan } from "../search-retrieval-plan.js";

const SUBJECT_NAMES: Record<string, string> = {
  CHEM: "Chemistry",
  CS: "Computer Science",
  MATH: "Mathematics",
};

class CompilerTestStatement {
  private params: unknown[] = [];

  constructor(private readonly sql: string) {}

  bind(...params: unknown[]): D1PreparedStatement {
    this.params = params;
    return this as unknown as D1PreparedStatement;
  }

  async first<T>(): Promise<T | null> {
    const subject = String(this.params[0] ?? "").toUpperCase();
    const normalized = String(this.params[0] ?? "").toLowerCase();

    if (this.sql.includes("SELECT id FROM subjects WHERE id = ?")) {
      return SUBJECT_NAMES[subject] ? ({ id: subject } as T) : null;
    }
    if (this.sql.includes("SELECT id FROM subjects WHERE LOWER(name) = ?")) {
      const match = Object.entries(SUBJECT_NAMES).find(
        ([, name]) => name.toLowerCase() === normalized,
      );
      return match ? ({ id: match[0] } as T) : null;
    }
    if (this.sql.includes("SELECT subject_id FROM subject_aliases WHERE alias = ?")) {
      return null;
    }
    if (this.sql.includes("SELECT DISTINCT subject FROM courses WHERE subject = ?")) {
      return SUBJECT_NAMES[subject] ? ({ subject } as T) : null;
    }
    if (this.sql.includes("SELECT name FROM subjects WHERE id = ?")) {
      return SUBJECT_NAMES[subject] ? ({ name: SUBJECT_NAMES[subject] } as T) : null;
    }

    return null;
  }
}

function db(): D1Database {
  return {
    prepare(sql: string): D1PreparedStatement {
      return new CompilerTestStatement(sql) as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
}

describe("createSearchPlan", () => {
  it("emits an immutable compiled artifact consumed unchanged by retrieval", async () => {
    const planning = await createSearchPlan(db(), "is cs 225 hard");

    expect(planning.plan.filters).toMatchObject({ subject: "CS", number: "225" });
    expect(planning.plan.filters.difficulty).toBeUndefined();
    expect(planning.queryResidual).toBe("");
    expect(planning.compilerEvents.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "query_language",
        "student_language",
        "validated_hints",
        "decision_search_rescue",
        "sanitize_and_freeze",
      ]),
    );
    expect(Object.isFrozen(planning)).toBe(true);
    expect(Object.isFrozen(planning.plan)).toBe(true);
    expect(Object.isFrozen(planning.plan.filters)).toBe(true);

    const controls = normalizeSearchControls();
    const budget = buildSearchCandidateBudget(
      planning.plan,
      { limit: 10, offset: 0 },
      controls,
    );
    const retrievalPlan = buildRetrievalPlan(planning.plan, controls, budget);

    expect(retrievalPlan.plan).toBe(planning.plan);
    expect(retrievalPlan.plan.filters).toEqual(planning.plan.filters);
  });

  it("compiles negated subject language as avoidance plus requirement intent", async () => {
    const planning = await createSearchPlan(db(), "easy science but no math");

    expect(planning.plan.filters.subject).toBeUndefined();
    expect(planning.plan.filters).toMatchObject({
      difficulty: "easy",
      requirement: { mode: "single", codes: ["NAT"] },
      not: { subjects: ["MATH"] },
    });
    expect(planning.plan.softPreferences).toMatchObject({
      lowMath: 0.86,
      lowWorkload: expect.any(Number),
    });
    expect(planning.queryResidual).toBe("");
  });

  it("uses context to resolve ambiguous subject/gened shorthand", async () => {
    const culturalStudies = await createSearchPlan(db(), "easy cs");
    expect(culturalStudies.plan.filters.subject).toBeUndefined();
    expect(culturalStudies.plan.filters.requirement).toEqual({
      mode: "single",
      codes: ["CS"],
    });
    expect(culturalStudies.plan.ambiguities?.[0]).toMatchObject({
      chosen: { type: "gened", value: "CS", label: "Cultural Studies" },
      alternatives: [
        { type: "subject", value: "CS", label: "Computer Science" },
      ],
    });

    const computerScience = await createSearchPlan(db(), "computer science class");
    expect(computerScience.plan.filters.subject).toBe("CS");
    expect(computerScience.plan.filters.requirement).toBeUndefined();
  });

  it("routes maintained student shorthand through the compiler once", async () => {
    const planning = await createSearchPlan(db(), "orgo");

    expect(planning.plan.filters.subject).toBe("CHEM");
    expect(planning.queryResidual).toBe("organic");
    expect(planning.plan.keywordQuery).toBe("organic");
    expect(planning.plan.semanticQuery).toBe("organic");
  });
});
