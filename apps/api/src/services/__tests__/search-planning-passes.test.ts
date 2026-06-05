import { describe, expect, it } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import { extractSearchPlanningInput } from "../search-plan-hints.js";
import {
  createPlanningContext,
  runPlanningPasses,
  type SearchPlanningPass,
} from "../search-planning-passes.js";

function context() {
  return createPlanningContext(
    {} as D1Database,
    "easy gen ed",
    extractSearchPlanningInput("easy gen ed"),
  );
}

describe("search planning pass harness", () => {
  it("rejects passes that read artifacts no prior pass produced", async () => {
    const pass: SearchPlanningPass = {
      id: "out_of_order",
      stage: "compile",
      reads: ["resolved_plan"],
      writes: ["query_language"],
      run() {},
    };

    await expect(runPlanningPasses(context(), [pass])).rejects.toThrow(
      'Search planning pass "out_of_order" reads missing artifacts: resolved_plan',
    );
  });

  it("rejects passes that declare outputs they do not leave behind", async () => {
    const pass: SearchPlanningPass = {
      id: "missing_output",
      stage: "resolve",
      reads: ["student_language_extraction"],
      writes: ["resolved_plan"],
      run() {},
    };

    await expect(runPlanningPasses(context(), [pass])).rejects.toThrow(
      'Search planning pass "missing_output" declared missing writes: resolved_plan',
    );
  });
});
