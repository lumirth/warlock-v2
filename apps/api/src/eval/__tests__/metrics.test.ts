import { describe, expect, it } from 'vitest';
import { calculateMetrics } from '../metrics.js';
import { generateReport } from '../report.js';
import type { EvalResult, GoldQuery } from '../types.js';

function query(id: number): GoldQuery {
  return {
    id,
    query: `query ${id}`,
    expected_filters: {},
    expected_residual: '',
    category: 'decision',
  };
}

function result(
  id: number,
  parseViolations: string[],
  resultViolations: string[],
): EvalResult {
  return {
    query: query(id),
    actualFilters: {},
    actualResidual: '',
    results: [],
    reciprocalRank: null,
    violations: [...parseViolations, ...resultViolations],
    parseViolations,
    resultViolations,
    tierReached: null,
  };
}

describe('eval metrics', () => {
  it('keeps parse and result-coherence failures visible as separate scorecards', () => {
    const metrics = calculateMetrics([
      result(1, ['filters.subject expected CS'], []),
      result(2, [], ['results expected to be non-empty']),
      result(3, [], []),
    ]);

    expect(metrics.violationCount).toBe(2);
    expect(metrics.parseViolationCount).toBe(1);
    expect(metrics.resultViolationCount).toBe(1);
    expect(metrics.parseFailedQueries).toBe(1);
    expect(metrics.resultFailedQueries).toBe(1);

    expect(generateReport(metrics)).toContain('Parse Violations: 1 across 1 queries');
    expect(generateReport(metrics)).toContain('Result-Coherence Violations: 1 across 1 queries');
  });
});
