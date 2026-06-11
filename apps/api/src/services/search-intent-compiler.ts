import type {
  SearchIntentKind,
  SearchPlan,
  SearchPlanWarning,
  SearchPlanWarningKind,
} from './search-planner-types.js';
import {
  GENERIC_REQUIREMENT_CODES,
  hasRequirementFilter,
  requirementFilter,
} from '@uiuc-course-search/query-types';
import { withSearchPlanUpdates } from './search-plan-model.js';
import {
  ASYNC_PATTERNS,
  COMPARISON_PATTERNS,
  COMPRESSED_TERM_PATTERNS,
  GENERIC_INTENT_PATTERNS,
  GENERIC_REQUIREMENT_PATTERNS,
  NON_MAJOR_PATTERNS,
  REQUIREMENT_PATTERNS,
  STUDENT_LANGUAGE_INTENT_RULES,
  STUDENT_PROFILE_PATTERNS,
} from './student-language-lexicon.js';

type TimePreference = {
  key: 'startAfterMinutes' | 'startBeforeMinutes';
  value: number;
  raw: string;
};

interface SearchIntentCompilationResult {
  plan: SearchPlan;
  queryResidual: string;
}

type MutableSearchIntentResult = {
  queryResidual: string;
};

export function compileSearchIntent(
  plan: SearchPlan,
  rawQuery: string,
  queryResidual: string
): SearchIntentCompilationResult {
  let nextResidual = queryResidual;
  const nextPlan = withSearchPlanUpdates(plan, draft => {
    nextResidual = applySearchIntent(draft, rawQuery, queryResidual).queryResidual;
  });

  return {
    plan: nextPlan,
    queryResidual: nextResidual,
  };
}

function applySearchIntent(
  plan: SearchPlan,
  rawQuery: string,
  queryResidual: string
): MutableSearchIntentResult {
  const queryTypes = new Set<SearchIntentKind>();
  const negativeTerms = new Set<string>();
  const warnings = new Map<SearchPlanWarningKind, SearchPlanWarning>();
  const removePatterns: RegExp[] = [];
  const normalizedRaw = rawQuery.toLowerCase();

  for (const rule of STUDENT_LANGUAGE_INTENT_RULES) {
    if (!rule.patterns.some(pattern => pattern.test(rawQuery))) {
      continue;
    }

    for (const queryType of rule.queryTypes) queryTypes.add(queryType);
    for (const term of rule.negativeTerms ?? []) negativeTerms.add(term);
    for (const item of rule.warnings ?? []) warnings.set(item.kind, item);
    Object.assign(plan.softPreferences = { ...plan.softPreferences }, rule.softPreferences);
    removePatterns.push(...(rule.removePatterns ?? rule.patterns));
  }

  if ((plan.filters.subject && plan.filters.number) || plan.filters.crn) {
    queryTypes.add('exact_course');
  }

  if (hasGenericRequirementIntent(rawQuery) && !hasRequirementFilter(plan.filters)) {
    plan.filters.requirement = requirementFilter("any", GENERIC_REQUIREMENT_CODES);
  }

  if (hasRequirementIntent(plan, rawQuery)) {
    queryTypes.add('requirement');
  }

  if (hasScheduleIntent(plan, rawQuery)) {
    queryTypes.add('schedule');
  }

  if (STUDENT_PROFILE_PATTERNS.some(pattern => pattern.test(rawQuery))) {
    queryTypes.add('degree_progress');
    warnings.set(
      'student_profile_required',
      warning('student_profile_required', 'Personal degree progress requires a student profile or audit context.', 0.86)
    );
  }

  if (COMPARISON_PATTERNS.some(pattern => pattern.test(rawQuery))) {
    queryTypes.add('comparison');
  }

  if (COMPRESSED_TERM_PATTERNS.some(pattern => pattern.test(rawQuery))) {
    queryTypes.add('schedule');
    plan.filters.compressedTerm = true;
    removePatterns.push(...COMPRESSED_TERM_PATTERNS);
  }

  const timePreference = extractTimePreference(rawQuery);
  if (timePreference) {
    queryTypes.add('schedule');
    plan.filters[timePreference.key] = timePreference.value;
    removePatterns.push(new RegExp(escapeRegex(timePreference.raw), 'gi'));
  }

  if (NON_MAJOR_PATTERNS.some(pattern => pattern.test(rawQuery))) {
    queryTypes.add('eligibility');
    plan.softPreferences = { ...plan.softPreferences, nonMajorFriendly: 0.72 };
    removePatterns.push(...NON_MAJOR_PATTERNS);
  }

  if (ASYNC_PATTERNS.some(pattern => pattern.test(rawQuery))) {
    queryTypes.add('schedule');
  }

  if (plan.filters.workload === 'easy') {
    queryTypes.add('subjective_vibe');
    plan.softPreferences = { ...plan.softPreferences, lowWorkload: plan.softPreferences?.lowWorkload ?? 0.8 };
  }

  if (plan.semanticQuery.trim() || plan.keywordQuery.trim()) {
    queryTypes.add('topic');
  }

  const shouldCleanIntentScaffolding = queryTypes.size > 0
    && !(queryTypes.size === 1 && queryTypes.has('topic'));
  let nextResidual = shouldCleanIntentScaffolding
    ? cleanIntentQuery(queryResidual, removePatterns)
    : queryResidual.trim();
  plan.semanticQuery = shouldCleanIntentScaffolding
    ? cleanIntentQuery(plan.semanticQuery, removePatterns)
    : plan.semanticQuery.trim();
  plan.keywordQuery = shouldCleanIntentScaffolding
    ? cleanIntentQuery(plan.keywordQuery, removePatterns)
    : plan.keywordQuery.trim();

  if (negativeTerms.has('math_heavy')) {
    nextResidual = removeNegativeResidualAliases(nextResidual, ['math', 'MATH']);
    plan.semanticQuery = removeNegativeResidualAliases(plan.semanticQuery, ['math', 'MATH']);
    plan.keywordQuery = removeNegativeResidualAliases(plan.keywordQuery, ['math', 'MATH']);
  }
  if (negativeTerms.has('biology_heavy')) {
    nextResidual = removeNegativeResidualAliases(nextResidual, ['bio', 'biology']);
    plan.semanticQuery = removeNegativeResidualAliases(plan.semanticQuery, ['bio', 'biology']);
    plan.keywordQuery = removeNegativeResidualAliases(plan.keywordQuery, ['bio', 'biology']);
  }

  const topicTerms = topicTermsFrom(plan.semanticQuery);
  if (topicTerms.length > 0) {
    queryTypes.add('topic');
  }

  plan.intent = {
    queryTypes: Array.from(queryTypes),
    negativeTerms: Array.from(negativeTerms),
    topicTerms,
    expandedTerms: expansionTermsFrom(plan.softPreferences?.topicExpansions),
    warnings: Array.from(warnings.values()),
    confidence: intentConfidence(queryTypes, normalizedRaw),
  };

  return { queryResidual: nextResidual };
}

export function mergeSearchIntentExpansions(plan: SearchPlan, expansions: string[]): SearchPlan {
  if (!plan.intent || expansions.length === 0) return plan;

  return withSearchPlanUpdates(plan, draft => {
    syncSearchIntentExpansions(draft, expansions);
  });
}

function syncSearchIntentExpansions(plan: SearchPlan, expansions: string[]): void {
  if (!plan.intent) return;

  const expandedTerms = new Set(plan.intent.expandedTerms);
  for (const expansion of expansions) {
    expandedTerms.add(expansion);
  }

  plan.intent = {
    ...plan.intent,
    expandedTerms: Array.from(expandedTerms),
  };
}

function hasRequirementIntent(plan: SearchPlan, rawQuery: string): boolean {
  return hasRequirementFilter(plan.filters)
    || REQUIREMENT_PATTERNS.some(pattern => pattern.test(rawQuery));
}

function hasGenericRequirementIntent(rawQuery: string): boolean {
  return GENERIC_REQUIREMENT_PATTERNS.some(pattern => pattern.test(rawQuery));
}

function hasScheduleIntent(plan: SearchPlan, rawQuery: string): boolean {
  return Boolean(
    plan.filters.online !== undefined
    || plan.filters.days
    || plan.filters.time
    || plan.filters.credits !== undefined
    || plan.filters.status
    || plan.filters.partOfTerm
  ) || COMPRESSED_TERM_PATTERNS.some(pattern => pattern.test(rawQuery));
}

function cleanIntentQuery(query: string, removePatterns: RegExp[]): string {
  let cleaned = query;
  for (const pattern of [...removePatterns, ...GENERIC_INTENT_PATTERNS]) {
    cleaned = cleaned.replace(pattern, ' ');
  }

  return cleaned
    .replace(/\b(?:and|or|but|with|for|to|of|that|doesn'?t|dont|don't)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function removeNegativeResidualAliases(query: string, aliases: string[]): string {
  let cleaned = query;
  for (const alias of aliases) {
    cleaned = cleaned.replace(new RegExp(`\\b${escapeRegex(alias)}\\b`, 'gi'), ' ');
  }
  return cleaned.replace(/\b(?:not|less)\b/gi, ' ').replace(/\s+/g, ' ').trim();
}

function topicTermsFrom(query: string): string[] {
  const cleaned = query.trim();
  return cleaned ? [cleaned] : [];
}

function expansionTermsFrom(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function intentConfidence(queryTypes: Set<SearchIntentKind>, normalizedRaw: string): number {
  if (queryTypes.has('exact_course')) return 0.95;
  if (queryTypes.size >= 3) return 0.82;
  if (normalizedRaw.length > 0 && queryTypes.size > 0) return 0.74;
  return 0.5;
}

function warning(kind: SearchPlanWarningKind, message: string, confidence: number): SearchPlanWarning {
  return { kind, message, confidence };
}

function extractTimePreference(rawQuery: string): TimePreference | null {
  const lower = rawQuery.toLowerCase();
  if (/\bafter\s+lunch\b/.test(lower)) {
    return {
      key: 'startAfterMinutes',
      value: 12 * 60,
      raw: 'after lunch',
    };
  }
  if (/\bbefore\s+lunch\b/.test(lower) || /\bmorning\b/.test(lower)) {
    return {
      key: 'startBeforeMinutes',
      value: 12 * 60,
      raw: /\bbefore\s+lunch\b/.test(lower) ? 'before lunch' : 'morning',
    };
  }

  const match = /\b(after|before)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(rawQuery);
  if (!match) return null;

  const hour = Number.parseInt(match[2], 10);
  const minute = match[3] ? Number.parseInt(match[3], 10) : 0;
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;

  const meridiem = match[4]?.toLowerCase();
  let normalizedHour = hour;
  if (meridiem === 'pm' && hour < 12) normalizedHour += 12;
  if (meridiem === 'am' && hour === 12) normalizedHour = 0;
  if (!meridiem && hour >= 1 && hour <= 7) normalizedHour += 12;

  return {
    key: match[1].toLowerCase() === 'after' ? 'startAfterMinutes' : 'startBeforeMinutes',
    value: (normalizedHour * 60) + minute,
    raw: match[0],
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
