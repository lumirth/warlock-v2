import { mkdirSync, writeFileSync } from "node:fs";
import {
  evaluateCorpusCoverage,
  findDuplicateQueryIds,
  formatCorpusCoverageReport,
} from "../src/eval/corpus-coverage.js";
import { GOLDEN_QUERIES } from "../src/eval/golden-queries.js";
import { evaluatePlanningCorpus } from "../src/eval/planning-smoke.js";
import type { EvalResult } from "../src/eval/types.js";

function formatReport(results: EvalResult[]): string {
  const failures = results.filter((result) => result.violations.length > 0);
  const lines = [
    "# Eval Smoke Report",
    "",
    "Validates canonical query interpretation and final SearchPlan filters with a hermetic API-owned database port.",
    "",
    `Total queries: ${results.length}`,
    `Passing queries: ${results.length - failures.length}`,
    `Failed queries: ${failures.length}`,
    "",
    "## Query Results",
    "",
  ];

  for (const result of results) {
    lines.push(`- ${result.violations.length === 0 ? "PASS" : "FAIL"} ${result.query.id}: ${result.query.query}`);
    for (const violation of result.violations) {
      lines.push(`  - ${violation}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const results = await evaluatePlanningCorpus();
  const coverage = evaluateCorpusCoverage(GOLDEN_QUERIES);
  const duplicateIds = findDuplicateQueryIds(GOLDEN_QUERIES);
  const report = `${formatReport(results)}\n${formatCorpusCoverageReport(coverage)}`;
  const artifactDirectory = new URL("../../../artifacts/", import.meta.url);

  mkdirSync(artifactDirectory, { recursive: true });
  writeFileSync(new URL("eval-smoke-report.md", artifactDirectory), report);
  writeFileSync(
    new URL("eval-smoke-results.json", artifactDirectory),
    `${JSON.stringify(results, null, 2)}\n`,
  );
  console.log(report);

  if (
    results.some((result) => result.violations.length > 0)
    || coverage.some((result) => !result.passes)
    || duplicateIds.length > 0
  ) {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
