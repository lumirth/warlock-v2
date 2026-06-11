import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { createSearchPlan } from "../services/search-plan-compiler.js";
import {
  isKnownSubjectCode,
  subjectName,
  subjectNames,
} from "../services/subject-taxonomy.js";
import {
  checkExpectedKeys,
  checkExpectedObject,
  checkExpectedIntent,
} from "./checks.js";
import { GOLDEN_QUERIES } from "./golden-queries.js";
import type { EvalResult } from "./types.js";

type D1Row = Record<string, unknown>;

class PlanningEvalStatement {
  private params: unknown[] = [];

  constructor(private readonly sql: string) {}

  bind(...params: unknown[]): D1PreparedStatement {
    this.params = params;
    return this as unknown as D1PreparedStatement;
  }

  async first<T = D1Row>(): Promise<T | null> {
    if (this.sql.includes("SELECT id FROM subjects WHERE id = ?")) {
      const code = String(this.params[0] ?? "").toUpperCase();
      return isKnownSubjectCode(code) ? ({ id: code } as T) : null;
    }

    if (this.sql.includes("SELECT id FROM subjects WHERE LOWER(name) = ?")) {
      const name = String(this.params[0] ?? "").toLowerCase();
      const code = Object.entries(subjectNames()).find(
        ([, value]) => value.toLowerCase() === name,
      )?.[0];
      return code ? ({ id: code } as T) : null;
    }

    if (this.sql.includes("SELECT id FROM subjects") && this.sql.includes("WHERE name LIKE ?")) {
      const needle = String(this.params[0] ?? "").replace(/%/g, "").toLowerCase();
      const code = Object.entries(subjectNames()).find(
        ([subjectCode, value]) =>
          value.toLowerCase().includes(needle)
          || subjectCode.toLowerCase().includes(needle),
      )?.[0];
      return code ? ({ id: code } as T) : null;
    }

    if (this.sql.includes("SELECT DISTINCT subject FROM courses WHERE subject = ?")) {
      const code = String(this.params[0] ?? "").toUpperCase();
      return isKnownSubjectCode(code) ? ({ subject: code } as T) : null;
    }

    if (this.sql.includes("SELECT name FROM subjects WHERE id = ?")) {
      const code = String(this.params[0] ?? "").toUpperCase();
      return { name: subjectName(code) ?? code } as T;
    }

    return null;
  }

  async all<T = D1Row>(): Promise<D1Result<T>> {
    if (this.sql.includes("FROM instructors")) {
      const needle = String(this.params[0] ?? "").replace(/%/g, "").toLowerCase();
      const resolvable = new Set(["fagen", "fagen-ulmschneider", "ulmschneider", "o'brien"]);
      return {
        results: resolvable.has(needle) ? ([{ id: 1 }] as T[]) : [],
        success: true,
        meta: {},
      } as unknown as D1Result<T>;
    }

    return {
      results: [],
      success: true,
      meta: {},
    } as unknown as D1Result<T>;
  }
}

function createPlanningEvalDb(): D1Database {
  return {
    prepare(sql: string): D1PreparedStatement {
      return new PlanningEvalStatement(sql) as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
}

export async function evaluatePlanningCorpus(
  db: D1Database = createPlanningEvalDb(),
): Promise<EvalResult[]> {
  return Promise.all(GOLDEN_QUERIES.map(async (query) => {
    const { plan } = await createSearchPlan(db, query.query);
    const actualFilters = { ...plan.filters };
    const violations = [
      ...checkExpectedObject("filters", query.expected_filters, actualFilters),
      ...checkExpectedKeys("filters", query.expected_filter_keys, actualFilters),
      ...checkExpectedObject("softPreferences", query.expected_soft_preferences, plan.softPreferences),
      ...checkExpectedIntent(query, plan.intent),
    ];

    return {
      query,
      actualFilters,
      results: [],
      reciprocalRank: null,
      violations,
      parseViolations: violations,
      resultViolations: [],
    };
  }));
}
