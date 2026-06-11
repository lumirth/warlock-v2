import type { Ai, D1Database, VectorizeIndex } from "@cloudflare/workers-types";
import { describe, expect, it } from "vitest";
import { buildSearchCandidateBudget } from "../search-budget.js";
import { normalizeSearchControls } from "../search-controls.js";
import { executeRetrievalLanes } from "../search-retrieval-lane-executors.js";
import { buildRetrievalPlan } from "../search-retrieval-plan.js";

describe("executeRetrievalLanes", () => {
  it("reports which lanes completed so later stages do not re-run failed lanes", async () => {
    const retrievalPlan = buildRetrievalPlan(
      {
        filters: {},
        keywordQuery: "easy ai",
        semanticQuery: "",
      },
      normalizeSearchControls({ scope: "all" }),
      buildSearchCandidateBudget(),
    );
    const db = {
      prepare: (sql: string) => {
        if (sql.includes("sections_fts")) {
          throw new Error("section index unavailable");
        }
        return {
          bind: () => ({
            all: async () => ({ results: [] }),
          }),
        };
      },
    } as unknown as D1Database;

    await expect(executeRetrievalLanes({
      db,
      vectorize: {} as VectorizeIndex,
      ai: {} as Ai,
      retrievalPlan,
    })).resolves.toEqual({
      laneResults: [],
      successfulLanes: ["official_text"],
      failedLanes: ["section_text"],
    });
  });

  it("fails truthfully when every executable lane fails", async () => {
    const retrievalPlan = buildRetrievalPlan(
      {
        filters: { subject: "CS", number: "225" },
        keywordQuery: "",
        semanticQuery: "",
      },
      normalizeSearchControls(),
      buildSearchCandidateBudget(),
    );
    const db = {
      prepare: () => {
        throw new Error("database unavailable");
      },
    } as unknown as D1Database;

    await expect(executeRetrievalLanes({
      db,
      vectorize: {} as VectorizeIndex,
      ai: {} as Ai,
      retrievalPlan,
    })).rejects.toThrow("All search retrieval lanes failed");
  });
});
