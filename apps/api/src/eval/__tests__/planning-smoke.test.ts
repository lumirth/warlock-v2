import { describe, expect, it } from "vitest";
import { evaluatePlanningCorpus } from "../planning-smoke.js";

describe("canonical planning corpus", () => {
  it("compiles every golden query to its expected final filters and residual", async () => {
    const results = await evaluatePlanningCorpus();
    const failures = results
      .filter((result) => result.violations.length > 0)
      .map((result) => ({
        id: result.query.id,
        query: result.query.query,
        violations: result.violations,
      }));

    expect(failures).toEqual([]);
  });
});
