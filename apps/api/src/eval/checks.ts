import type { GoldQuery, EvalResult } from './types.js';

export interface ApiSearchResult {
  id: string;
  title: string;
  subject: string;
  number: string;
  avg_gpa?: number;
  gened?: string | null;
  _score?: number;
}

export interface SearchResponseForEval {
  results: ApiSearchResult[];
  meta: {
    plan: {
      filters: Record<string, unknown>;
      softPreferences?: Record<string, unknown>;
    };
    extraction: {
      hints: unknown[];
    };
    query: {
      residual: string;
    };
    fallback?: {
      tierReached: number;
      constraintsRelaxed?: string[];
      originalResultCount?: number;
    };
    term?: {
      activeTermId: string | null;
      registrableTermId: string | null;
    };
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatValue(value: unknown): string {
  return JSON.stringify(value);
}

function valueMatches(expected: unknown, actual: unknown): boolean {
  if (Array.isArray(expected)) {
    return Array.isArray(actual)
      && expected.length === actual.length
      && expected.every((item, index) => valueMatches(item, actual[index]));
  }

  if (isRecord(expected)) {
    if (!isRecord(actual)) return false;
    return Object.entries(expected).every(([key, value]) => valueMatches(value, actual[key]));
  }

  return Object.is(expected, actual);
}

export function checkExpectedObject(
  label: string,
  expected: Record<string, unknown> | undefined,
  actual: Record<string, unknown> | undefined
): string[] {
  if (!expected || Object.keys(expected).length === 0) return [];
  const violations: string[] = [];
  const actualRecord = actual ?? {};

  for (const [key, expectedValue] of Object.entries(expected)) {
    if (!valueMatches(expectedValue, actualRecord[key])) {
      violations.push(
        `${label}.${key} expected ${formatValue(expectedValue)}, got ${formatValue(actualRecord[key])}`
      );
    }
  }

  return violations;
}

export function checkExpectedKeys(
  label: string,
  expectedKeys: string[] | undefined,
  actual: Record<string, unknown> | undefined
): string[] {
  if (!expectedKeys || expectedKeys.length === 0) return [];
  const actualRecord = actual ?? {};

  return expectedKeys
    .filter(key => actualRecord[key] === undefined)
    .map(key => `${label}.${key} expected to be present`);
}

export function checkExpectedResidual(query: GoldQuery, actualResidual: string): string[] {
  return actualResidual === query.expected_residual
    ? []
    : [`residual expected ${formatValue(query.expected_residual)}, got ${formatValue(actualResidual)}`];
}

export function checkInvariants(query: GoldQuery, results: ApiSearchResult[]): string[] {
  const violations: string[] = [];
  if (!query.invariants) return violations;

  for (const result of results) {
    if (query.invariants.subject && result.subject !== query.invariants.subject) {
      violations.push(`Result ${result.id} has subject=${result.subject}, expected ${query.invariants.subject}`);
    }

    if (query.invariants.level_gte) {
      const level = parseInt(result.number.charAt(0), 10) * 100;
      if (level < query.invariants.level_gte) {
        violations.push(`Result ${result.id} is level ${level}, expected >= ${query.invariants.level_gte}`);
      }
    }

    if (query.invariants.level_lte) {
      const level = parseInt(result.number.charAt(0), 10) * 100;
      if (level > query.invariants.level_lte) {
        violations.push(`Result ${result.id} is level ${level}, expected <= ${query.invariants.level_lte}`);
      }
    }

    if (query.invariants.no_subject && result.subject === query.invariants.no_subject) {
      violations.push(`Result ${result.id} has forbidden subject=${query.invariants.no_subject}`);
    }
  }

  return violations;
}

export function calculateReciprocalRank(query: GoldQuery, results: ApiSearchResult[]): number | null {
  if (!query.expected_top1 && !query.expected_top1_title) {
    return null;
  }

  for (let i = 0; i < Math.min(results.length, 10); i++) {
    const result = results[i];

    if (query.expected_top1) {
      const pattern = query.expected_top1.replace('*', '.*');
      if (new RegExp(`^${pattern}$`).test(result.id)) {
        return 1 / (i + 1);
      }
    }

    if (query.expected_top1_title) {
      if (result.title.toLowerCase().includes(query.expected_top1_title.toLowerCase())) {
        return 1 / (i + 1);
      }
    }
  }

  return 0;
}

export function evaluateSearchResponse(query: GoldQuery, data: SearchResponseForEval): EvalResult {
  const results = data.results;
  const violations = [
    ...checkExpectedObject('filters', query.expected_filters, data.meta.plan.filters),
    ...checkExpectedKeys('filters', query.expected_filter_keys, data.meta.plan.filters),
    ...checkExpectedObject('softPreferences', query.expected_soft_preferences, data.meta.plan.softPreferences),
    ...checkExpectedResidual(query, data.meta.query.residual),
    ...checkInvariants(query, results),
  ];

  if (query.require_term_metadata && !data.meta.term) {
    violations.push('term metadata is missing');
  }

  const relaxed = data.meta.fallback?.constraintsRelaxed ?? [];
  if (!query.allow_fallback_relaxation && relaxed.length > 0) {
    violations.push(`fallback relaxed hard constraints: ${relaxed.join(', ')}`);
  }

  return {
    query,
    actualFilters: data.meta.plan.filters,
    actualResidual: data.meta.query.residual,
    results,
    reciprocalRank: calculateReciprocalRank(query, results),
    violations,
    tierReached: data.meta.fallback?.tierReached ?? null,
  };
}
