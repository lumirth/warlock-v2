import type { EvalMetrics } from './types.js';

export function generateReport(metrics: EvalMetrics, label: string = 'Current'): string {
  const lines: string[] = [];

  lines.push(`\n=== Search Evaluation Report: ${label} ===\n`);
  lines.push(`Total Queries: ${metrics.totalQueries}`);
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

export function compareReports(before: EvalMetrics, after: EvalMetrics): string {
  const lines: string[] = [];

  const delta = (a: number, b: number) => {
    const diff = b - a;
    const sign = diff >= 0 ? '+' : '';
    return `${sign}${(diff * 100).toFixed(1)}%`;
  };

  lines.push(`\n=== Before/After Comparison ===\n`);
  lines.push(`MRR@10: ${(before.mrr10 * 100).toFixed(1)}% → ${(after.mrr10 * 100).toFixed(1)}% (${delta(before.mrr10, after.mrr10)})`);
  lines.push(`Top-1 Accuracy: ${(before.top1Accuracy * 100).toFixed(1)}% → ${(after.top1Accuracy * 100).toFixed(1)}% (${delta(before.top1Accuracy, after.top1Accuracy)})`);
  lines.push(`Violations: ${(before.constraintViolationRate * 100).toFixed(1)}% → ${(after.constraintViolationRate * 100).toFixed(1)}% (${delta(before.constraintViolationRate, after.constraintViolationRate)})`);
  lines.push(`Zero Results: ${(before.zeroResultRate * 100).toFixed(1)}% → ${(after.zeroResultRate * 100).toFixed(1)}% (${delta(before.zeroResultRate, after.zeroResultRate)})`);

  return lines.join('\n');
}
