import type { EvalResult } from './types.js';
import { GOLDEN_QUERIES } from './golden-queries.js';
import { calculateMetrics } from './metrics.js';
import { generateReport } from './report.js';
import { evaluateSearchResponse, type SearchResponseForEval } from './checks.js';

export async function runEvaluation(baseUrl: string): Promise<EvalResult[]> {
  console.log(`Running evaluation against ${baseUrl}...`);
  console.log(`Total queries: ${GOLDEN_QUERIES.length}\n`);

  const evalResults: EvalResult[] = [];

  for (const query of GOLDEN_QUERIES) {
    try {
      const url = `${baseUrl}/api/search?q=${encodeURIComponent(query.query)}&limit=20`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }

      const data = await response.json() as SearchResponseForEval;
      const result = evaluateSearchResponse(query, data);
      evalResults.push(result);

      // Progress indicator
      const status = result.violations.length > 0 ? 'FAIL' : 'PASS';
      const rankStatus = (query.expected_top1 || query.expected_top1_title) ? ` (RR: ${result.reciprocalRank?.toFixed(2)})` : '';
      console.log(`${status} [${query.id}] "${query.query}" - ${result.results.length} results, ${result.violations.length} violations${rankStatus}`);
      for (const violation of result.violations) {
        console.log(`  - ${violation}`);
      }

    } catch (error) {
      console.error(`FAIL [${query.id}] "${query.query}" - ERROR: ${error}`);
      evalResults.push({
        query,
        actualFilters: {},
        actualResidual: '',
        results: [],
        reciprocalRank: 0,
        violations: [`Fetch error: ${error}`],
        tierReached: null
      });
    }
  }

  const metrics = calculateMetrics(evalResults);
  console.log(generateReport(metrics));
  return evalResults;
}

// CLI entry point
declare const process: {
  argv: string[];
  exitCode?: number;
};
const baseUrl = process.argv[2] || 'http://localhost:8787';
runEvaluation(baseUrl)
  .then((results) => {
    const metrics = calculateMetrics(results);

    if (metrics.violationCount > 0 || metrics.missingExpectedTopCount > 0) {
      console.error(
        `Evaluation failed: ${metrics.violationCount} violations, ${metrics.missingExpectedTopCount} missing expected top results.`
      );
      process.exitCode = 1;
    }
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
