import type { Ai, D1Database, VectorizeIndex } from "@cloudflare/workers-types";
import { describe, expect, it } from "vitest";
import { buildSearchCandidateBudget } from "../search-budget.js";
import { normalizeSearchControls } from "../search-controls.js";
import { executeRetrievalLanes } from "../search-retrieval-lane-executors.js";
import { buildRetrievalPlan } from "../search-retrieval-plan.js";

describe("executeRetrievalLanes", () => {
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
