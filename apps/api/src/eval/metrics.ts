import type { EvalResult, EvalMetrics } from './types.js';

export function calculateMetrics(results: EvalResult[]): EvalMetrics {
  const totalQueries = results.length;

  // MRR@10 - only for queries with expected_top1
  const queriesWithExpected = results.filter(r => r.query.expected_top1 || r.query.expected_top1_title);
  const sumReciprocalRank = queriesWithExpected.reduce((sum, r) => {
    if (r.reciprocalRank !== null && r.reciprocalRank > 0) {
      return sum + r.reciprocalRank;
    }
    return sum;
  }, 0);
  const mrr10 = queriesWithExpected.length > 0
    ? sumReciprocalRank / queriesWithExpected.length
    : 0;

  // Top-1 accuracy
  const top1Correct = queriesWithExpected.filter(r => r.reciprocalRank === 1).length;
  const top1Accuracy = queriesWithExpected.length > 0
    ? top1Correct / queriesWithExpected.length
    : 0;

  // Constraint violation rate
  const queriesWithInvariants = results.filter(r => r.query.invariants && Object.keys(r.query.invariants).length > 0);
  const queriesWithViolations = queriesWithInvariants.filter(r => r.violations.length > 0);
  const constraintViolationRate = queriesWithInvariants.length > 0
    ? queriesWithViolations.length / queriesWithInvariants.length
    : 0;

  // Zero result rate
  const zeroResults = results.filter(r => r.results.length === 0);
  const zeroResultRate = totalQueries > 0 ? zeroResults.length / totalQueries : 0;
  const violationCount = results.reduce((sum, result) => sum + result.violations.length, 0);
  const failedQueries = results.filter(result => result.violations.length > 0).length;
  const passingQueries = totalQueries - failedQueries;
  const missingExpectedTopCount = results.filter(result =>
    (result.query.expected_top1 || result.query.expected_top1_title)
    && result.reciprocalRank === 0
  ).length;

  // By category
  const byCategory: Record<string, { count: number; mrr: number; violations: number }> = {};
  for (const result of results) {
    const cat = result.query.category;
    if (!byCategory[cat]) {
      byCategory[cat] = { count: 0, mrr: 0, violations: 0 };
    }
    byCategory[cat].count++;
    if (result.reciprocalRank !== null) {
      byCategory[cat].mrr += result.reciprocalRank;
    }
    if (result.violations.length > 0) {
      byCategory[cat].violations++;
    }
  }
  // Normalize MRR per category
  for (const cat of Object.keys(byCategory)) {
    const catResults = results.filter(r => r.query.category === cat && r.reciprocalRank !== null);
    if (catResults.length > 0) {
      byCategory[cat].mrr = byCategory[cat].mrr / catResults.length;
    }
  }

  return {
    totalQueries,
    passingQueries,
    failedQueries,
    violationCount,
    missingExpectedTopCount,
    mrr10,
    top1Accuracy,
    constraintViolationRate,
    zeroResultRate,
    byCategory
  };
}
