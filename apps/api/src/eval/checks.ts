import type { GoldQuery, EvalResult, ResultSelector } from './types.js';
import type { SearchIntent } from '../services/search-planner-types.js';
import { canonicalRequirementCode } from '@uiuc-course-search/query-types';

interface ApiSearchResult {
  id: string;
  title: string;
  subject: string;
  number: string;
  avg_gpa?: number;
  requirements?: Array<{
    categoryId?: string;
    category_id?: string;
    attributeCode?: string | null;
    attribute_code?: string | null;
  }>;
}

export interface SearchResponseForEval {
  results: unknown[];
  _debug?: {
    plan: {
      filters: Record<string, unknown>;
      softPreferences?: Record<string, unknown>;
      intent?: SearchIntent;
    };
    extraction: {
      hints: unknown[];
    };
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatValue(value: unknown): string {
  return JSON.stringify(value);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeRequirements(value: unknown): ApiSearchResult['requirements'] {
  if (!Array.isArray(value)) return undefined;

  return value
    .filter(isRecord)
    .map(requirement => ({
      categoryId: typeof requirement.categoryId === 'string' ? requirement.categoryId : undefined,
      category_id: typeof requirement.category_id === 'string' ? requirement.category_id : undefined,
      attributeCode: typeof requirement.attributeCode === 'string' || requirement.attributeCode === null
        ? requirement.attributeCode
        : undefined,
      attribute_code: typeof requirement.attribute_code === 'string' || requirement.attribute_code === null
        ? requirement.attribute_code
        : undefined,
    }));
}

function normalizeApiSearchResult(result: unknown): ApiSearchResult {
  if (!isRecord(result)) {
    return {
      id: '',
      title: '',
      subject: '',
      number: '',
    };
  }

  const publicCourse = isRecord(result.course) ? result.course : null;
  const source = publicCourse ?? result;
  const metrics = isRecord(source.metrics) ? source.metrics : {};

  return {
    id: stringValue(source.id ?? result.id),
    title: stringValue(source.title ?? result.title),
    subject: stringValue(source.subject ?? result.subject),
    number: stringValue(source.number ?? result.number),
    avg_gpa: numberValue(result.avg_gpa ?? metrics.avgGpa),
    requirements: normalizeRequirements(source.requirements ?? result.requirements),
  };
}

export function normalizeApiSearchResults(results: unknown[]): ApiSearchResult[] {
  return results.map(normalizeApiSearchResult);
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

function checkExpectedArraySubset<T>(
  label: string,
  expected: T[] | undefined,
  actual: T[] | undefined
): string[] {
  if (!expected || expected.length === 0) return [];
  const actualValues = new Set(actual ?? []);

  return expected
    .filter(value => !actualValues.has(value))
    .map(value => `${label} expected to include ${formatValue(value)}, got ${formatValue(actual ?? [])}`);
}

export function checkExpectedIntent(query: GoldQuery, intent: SearchIntent | undefined): string[] {
  if (!query.expected_intent) return [];
  const expected = query.expected_intent;
  const violations = [
    ...checkExpectedArraySubset('intent.queryTypes', expected.queryTypes, intent?.queryTypes),
    ...checkExpectedArraySubset('intent.negativeTerms', expected.negativeTerms, intent?.negativeTerms),
    ...checkExpectedArraySubset('intent.warnings', expected.warnings, intent?.warnings.map(warning => warning.kind)),
  ];

  if (!intent) {
    violations.push('intent expected to be present');
  }

  return violations;
}

function checkInvariants(query: GoldQuery, results: ApiSearchResult[]): string[] {
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

    if (query.invariants.requirement && !resultSatisfiesRequirement(result, query.invariants.requirement)) {
      violations.push(`Result ${result.id} does not satisfy requirement ${query.invariants.requirement}`);
    }
  }

  return violations;
}

function resultLevel(result: ApiSearchResult): number | null {
  const parsed = parseInt(result.number.charAt(0), 10);
  return Number.isFinite(parsed) ? parsed * 100 : null;
}

function resultSatisfiesRequirement(result: ApiSearchResult, requirement: string): boolean {
  const canonical = canonicalRequirementCode(requirement);
  if (!canonical) return false;
  return (result.requirements ?? []).some(entry =>
    canonicalRequirementCode(entry.categoryId ?? entry.category_id) === canonical
    || canonicalRequirementCode(entry.attributeCode ?? entry.attribute_code) === canonical
  );
}

function selectorMatches(selector: ResultSelector, result: ApiSearchResult): boolean {
  if (selector.id && selector.id !== result.id) return false;
  if (selector.subject && selector.subject !== result.subject) return false;
  if (selector.number && selector.number !== result.number) return false;
  if (
    selector.titleIncludes
    && !result.title.toLowerCase().includes(selector.titleIncludes.toLowerCase())
  ) {
    return false;
  }
  if (selector.requirement && !resultSatisfiesRequirement(result, selector.requirement)) return false;

  const level = resultLevel(result);
  if (selector.level_gte !== undefined && (level === null || level < selector.level_gte)) return false;
  if (selector.level_lte !== undefined && (level === null || level > selector.level_lte)) return false;

  return true;
}

function describeSelector(selector: ResultSelector): string {
  return Object.entries(selector)
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(', ');
}

export function checkResultCoherence(query: GoldQuery, results: ApiSearchResult[]): string[] {
  const expected = query.expected_results;
  if (!expected) return [];

  const violations: string[] = [];
  const topK = Math.min(expected.top_k ?? 10, results.length);
  const topResults = results.slice(0, topK);

  if (expected.non_empty && results.length === 0) {
    violations.push('results expected to be non-empty');
  }

  for (const selector of expected.must_include ?? []) {
    if (!topResults.some(result => selectorMatches(selector, result))) {
      violations.push(`top ${expected.top_k ?? 10} expected to include ${describeSelector(selector)}`);
    }
  }

  for (const selector of expected.must_exclude ?? []) {
    const badResult = topResults.find(result => selectorMatches(selector, result));
    if (badResult) {
      violations.push(`top ${expected.top_k ?? 10} must exclude ${describeSelector(selector)}, got ${badResult.id}`);
    }
  }

  if (expected.all_top_k?.subjects?.length) {
    const allowed = new Set(expected.all_top_k.subjects);
    for (const result of topResults) {
      if (!allowed.has(result.subject)) {
        violations.push(`Result ${result.id} subject=${result.subject}, expected one of ${Array.from(allowed).join(', ')}`);
      }
    }
  }

  if (expected.all_top_k?.no_subjects?.length) {
    const forbidden = new Set(expected.all_top_k.no_subjects);
    for (const result of topResults) {
      if (forbidden.has(result.subject)) {
        violations.push(`Result ${result.id} has forbidden subject=${result.subject}`);
      }
    }
  }

  if (expected.all_top_k?.requirement) {
    for (const result of topResults) {
      if (!resultSatisfiesRequirement(result, expected.all_top_k.requirement)) {
        violations.push(`Result ${result.id} does not include requirement ${expected.all_top_k.requirement}`);
      }
    }
  }

  if (expected.all_top_k?.level_gte !== undefined || expected.all_top_k?.level_lte !== undefined) {
    for (const result of topResults) {
      const level = resultLevel(result);
      if (expected.all_top_k.level_gte !== undefined && (level === null || level < expected.all_top_k.level_gte)) {
        violations.push(`Result ${result.id} is level ${level}, expected >= ${expected.all_top_k.level_gte}`);
      }
      if (expected.all_top_k.level_lte !== undefined && (level === null || level > expected.all_top_k.level_lte)) {
        violations.push(`Result ${result.id} is level ${level}, expected <= ${expected.all_top_k.level_lte}`);
      }
    }
  }

  if (expected.max_graduate_top_k !== undefined) {
    const graduateCount = topResults.filter(result => (resultLevel(result) ?? 0) >= 500).length;
    if (graduateCount > expected.max_graduate_top_k) {
      violations.push(`top ${expected.top_k ?? 10} has ${graduateCount} graduate-level results, expected <= ${expected.max_graduate_top_k}`);
    }
  }

  return violations;
}

function calculateReciprocalRank(query: GoldQuery, results: ApiSearchResult[]): number | null {
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
  const results = normalizeApiSearchResults(data.results);
  const plannerDebug = data._debug;
  if (!plannerDebug) {
    const missingDebug = 'planner debug payload is missing; run eval against /admin/debug/search-plan with an admin token';
    return {
      query,
      actualFilters: {},
      results,
      reciprocalRank: calculateReciprocalRank(query, results),
      violations: [missingDebug],
      parseViolations: [missingDebug],
      resultViolations: [],
    };
  }

  const parseViolations = [
    ...checkExpectedObject('filters', query.expected_filters, plannerDebug.plan.filters),
    ...checkExpectedKeys('filters', query.expected_filter_keys, plannerDebug.plan.filters),
    ...checkExpectedObject('softPreferences', query.expected_soft_preferences, plannerDebug.plan.softPreferences),
    ...checkExpectedIntent(query, plannerDebug.plan.intent),
  ];
  const resultViolations = checkPublicResultViolations(query, results);

  const violations = [...parseViolations, ...resultViolations];

  return {
    query,
    actualFilters: plannerDebug.plan.filters,
    results,
    reciprocalRank: calculateReciprocalRank(query, results),
    violations,
    parseViolations,
    resultViolations,
  };
}

export function evaluatePublicSearchResponse(query: GoldQuery, data: SearchResponseForEval): EvalResult {
  const results = normalizeApiSearchResults(data.results);
  const resultViolations = checkPublicResultViolations(query, results);

  return {
    query,
    actualFilters: {},
    results,
    reciprocalRank: calculateReciprocalRank(query, results),
    violations: resultViolations,
    parseViolations: [],
    resultViolations,
  };
}

function checkPublicResultViolations(
  query: GoldQuery,
  results: ApiSearchResult[],
): string[] {
  const violations = [
    ...checkInvariants(query, results),
    ...checkResultCoherence(query, results),
  ];

  return violations;
}
