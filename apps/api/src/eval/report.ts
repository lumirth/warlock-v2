import type { EvalMetrics } from './types.js';

export function generateReport(metrics: EvalMetrics, label: string = 'Current'): string {
  const lines: string[] = [];

  lines.push(`\n=== Search Evaluation Report: ${label} ===\n`);
  lines.push(`Total Queries: ${metrics.totalQueries}`);
  lines.push(`Passing Queries: ${metrics.passingQueries}`);
  lines.push(`Failed Queries: ${metrics.failedQueries}`);
  lines.push(`Violation Count: ${metrics.violationCount}`);
  lines.push(`Parse Violations: ${metrics.parseViolationCount} across ${metrics.parseFailedQueries} queries`);
  lines.push(`Result-Coherence Violations: ${metrics.resultViolationCount} across ${metrics.resultFailedQueries} queries`);
  lines.push(`Missing Expected Top Results: ${metrics.missingExpectedTopCount}`);
  lines.push(`MRR@10: ${(metrics.mrr10 * 100).toFixed(1)}%`);
  lines.push(`Top-1 Accuracy: ${(metrics.top1Accuracy * 100).toFixed(1)}%`);
  lines.push(`Constraint Violation Rate: ${(metrics.constraintViolationRate * 100).toFixed(1)}%`);
  lines.push(`Zero Result Rate: ${(metrics.zeroResultRate * 100).toFixed(1)}%`);

  lines.push(`\n--- By Category ---`);
  for (const [cat, data] of Object.entries(metrics.byCategory)) {
    lines.push(`${cat}: ${data.count} queries, MRR=${(data.mrr * 100).toFixed(1)}%, Violations=${data.violations}`);
  }

  return lines.join('\n');
}
