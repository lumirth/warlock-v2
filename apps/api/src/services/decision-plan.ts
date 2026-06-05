import type {
  DecisionQueryType,
  SearchPlan,
  SearchPlanAssumption,
  SearchPlanWarning,
  SearchPlanWarningKind,
  SearchRelaxationStep,
} from './search-planner-types.js';
import {
  hasRequirementFilter,
  requirementFilter,
} from '@uiuc-course-search/query-types';
import { withSearchPlanUpdates } from './search-plan-model.js';
import { GENERIC_REQUIREMENT_CODES } from './requirement-codes.js';
import {
  ASYNC_PATTERNS,
  COMPARISON_PATTERNS,
  COMPRESSED_TERM_PATTERNS,
  GENERIC_DECISION_PATTERNS,
  GENERIC_REQUIREMENT_PATTERNS,
  HELP_PATTERNS,
  NON_MAJOR_PATTERNS,
  REQUIREMENT_PATTERNS,
  STUDENT_LANGUAGE_RESCUE_RULES,
  STUDENT_PROFILE_PATTERNS,
} from './student-language-lexicon.js';
import { lanesForDecisionQueryTypes } from './search-decision-lane-policy.js';

type TimePreference = {
  key: 'startAfterMinutes' | 'startBeforeMinutes';
  value: number;
  raw: string;
};

export interface DecisionSearchRescueResult {
  plan: SearchPlan;
  queryResidual: string;
}

type MutableDecisionSearchRescueResult = {
  queryResidual: string;
};

export function compileDecisionSearchRescue(
  plan: SearchPlan,
  rawQuery: string,
  queryResidual: string
): DecisionSearchRescueResult {
  let nextResidual = queryResidual;
  const nextPlan = withSearchPlanUpdates(plan, draft => {
    nextResidual = applyDecisionSearchRescue(draft, rawQuery, queryResidual).queryResidual;
  });

  return {
    plan: nextPlan,
    queryResidual: nextResidual,
  };
}

function applyDecisionSearchRescue(
  plan: SearchPlan,
  rawQuery: string,
  queryResidual: string
): MutableDecisionSearchRescueResult {
  const queryTypes = new Set<DecisionQueryType>();
  const negativeTerms = new Set<string>();
  const assumptions = new Map<string, SearchPlanAssumption>();
  const warnings = new Map<SearchPlanWarningKind, SearchPlanWarning>();
  const relaxations = new Map<string, SearchRelaxationStep>();
  const removePatterns: RegExp[] = [];
  const normalizedRaw = rawQuery.toLowerCase();

  for (const rule of STUDENT_LANGUAGE_RESCUE_RULES) {
    if (!rule.patterns.some(pattern => pattern.test(rawQuery))) {
      continue;
    }

    for (const queryType of rule.queryTypes) queryTypes.add(queryType);
    for (const term of rule.negativeTerms ?? []) negativeTerms.add(term);
    for (const item of rule.assumptions ?? []) assumptions.set(item.kind, item);
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
    assumptions.set('requirement_match', assumption('requirement_match', 'GenEd match matters', 0.78));
    if (/\bcounts?\s+for\s+something\b/i.test(rawQuery)) {
      assumptions.set(
        'requirement_ambiguous',
        assumption('requirement_ambiguous', 'Could mean GenEd, elective, major requirement, or advanced hours', 0.68)
      );
    }
  }

  if (hasScheduleIntent(plan, rawQuery)) {
    queryTypes.add('schedule');
    assumptions.set('schedule_fit', assumption('schedule_fit', 'Schedule or delivery fit matters', 0.78));
  }

  if (STUDENT_PROFILE_PATTERNS.some(pattern => pattern.test(rawQuery))) {
    queryTypes.add('degree_progress');
    warnings.set(
      'student_profile_required',
      warning('student_profile_required', 'Personal degree progress requires a student profile or audit context.', 0.86)
    );
  }

  if (HELP_PATTERNS.some(pattern => pattern.test(rawQuery))) {
    queryTypes.add('help_or_how_to');
  }

  if (COMPARISON_PATTERNS.some(pattern => pattern.test(rawQuery))) {
    queryTypes.add('comparison');
  }

  if (COMPRESSED_TERM_PATTERNS.some(pattern => pattern.test(rawQuery))) {
    queryTypes.add('schedule');
    plan.softPreferences = { ...plan.softPreferences, compressedTerm: true };
    assumptions.set('compressed_term', assumption('compressed_term', 'Shorter part-of-term preferred', 0.7));
    removePatterns.push(...COMPRESSED_TERM_PATTERNS);
  }

  const timePreference = extractTimePreference(rawQuery);
  if (timePreference) {
    queryTypes.add('schedule');
    plan.softPreferences = { ...plan.softPreferences, [timePreference.key]: timePreference.value };
    assumptions.set(
      timePreference.key,
      assumption(timePreference.key, timePreference.key === 'startAfterMinutes' ? 'Starts after preferred time' : 'Starts before preferred time', 0.76)
    );
    removePatterns.push(new RegExp(escapeRegex(timePreference.raw), 'gi'));
  }

  if (NON_MAJOR_PATTERNS.some(pattern => pattern.test(rawQuery))) {
    queryTypes.add('eligibility');
    plan.softPreferences = { ...plan.softPreferences, nonMajorFriendly: 0.72 };
    assumptions.set('non_major_friendly', assumption('non_major_friendly', 'Non-major friendly preferred', 0.68));
    removePatterns.push(...NON_MAJOR_PATTERNS);
  }

  if (ASYNC_PATTERNS.some(pattern => pattern.test(rawQuery))) {
    queryTypes.add('schedule');
    plan.softPreferences = { ...plan.softPreferences, asyncFriendly: 0.84 };
    assumptions.set('async_friendly', assumption('async_friendly', 'Asynchronous delivery preferred', 0.82));
  }

  if (plan.filters.online === true) {
    assumptions.set('online_preferred', assumption('online_preferred', 'Online preferred', 0.86));
  }

  if (plan.filters.credits !== undefined) {
    assumptions.set('credit_count', assumption('credit_count', `${plan.filters.credits} credit hours`, 0.92));
  }

  if (plan.filters.workload === 'easy') {
    queryTypes.add('subjective_vibe');
    plan.softPreferences = { ...plan.softPreferences, lowWorkload: plan.softPreferences?.lowWorkload ?? 0.8 };
    assumptions.set('low_workload', assumption('low_workload', 'Low workload preferred', 0.82));
  }

  if (plan.semanticQuery.trim() || plan.keywordQuery.trim()) {
    queryTypes.add('topic');
  }

  const shouldCleanDecisionScaffolding = queryTypes.size > 0
    && !(queryTypes.size === 1 && queryTypes.has('topic'));
  let nextResidual = shouldCleanDecisionScaffolding
    ? cleanDecisionQuery(queryResidual, removePatterns)
    : queryResidual.trim();
  plan.semanticQuery = shouldCleanDecisionScaffolding
    ? cleanDecisionQuery(plan.semanticQuery, removePatterns)
    : plan.semanticQuery.trim();
  plan.keywordQuery = shouldCleanDecisionScaffolding
    ? cleanDecisionQuery(plan.keywordQuery, removePatterns)
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

  buildRelaxations(relaxations, {
    hasRequirement: queryTypes.has('requirement'),
    hasSchedule: queryTypes.has('schedule'),
    hasAvoidance: queryTypes.has('avoidance'),
    hasSubjective: queryTypes.has('subjective_vibe'),
    hasTopic: queryTypes.has('topic'),
    hasOnline: plan.filters.online === true,
  });

  if (queryTypes.size > 0) {
    const intents = new Set(plan.intents ?? []);
    intents.add('query_rescue');
    plan.intents = Array.from(intents);
  }

  const needsStudentProfile = warnings.has('student_profile_required');
  plan.rescue = {
    queryTypes: Array.from(queryTypes),
    negativeTerms: Array.from(negativeTerms),
    topicTerms,
    expandedTerms: expansionTermsFrom(plan.softPreferences?.topicExpansions),
    assumptions: Array.from(assumptions.values()),
    warnings: Array.from(warnings.values()),
    interpretedLanes: lanesForDecisionQueryTypes(queryTypes),
    relaxationPlan: Array.from(relaxations.values()),
    needsStudentProfile,
    confidence: rescueConfidence(queryTypes, normalizedRaw),
  };

  return { queryResidual: nextResidual };
}

export function compileDecisionSearchExpansions(plan: SearchPlan, expansions: string[]): SearchPlan {
  if (!plan.rescue || expansions.length === 0) return plan;

  return withSearchPlanUpdates(plan, draft => {
    syncDecisionSearchExpansions(draft, expansions);
  });
}

function syncDecisionSearchExpansions(plan: SearchPlan, expansions: string[]): void {
  if (!plan.rescue) return;

  const expandedTerms = new Set(plan.rescue.expandedTerms);
  for (const expansion of expansions) {
    expandedTerms.add(expansion);
  }

  plan.rescue = {
    ...plan.rescue,
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

function buildRelaxations(
  relaxations: Map<string, SearchRelaxationStep>,
  context: {
    hasRequirement: boolean;
    hasSchedule: boolean;
    hasAvoidance: boolean;
    hasSubjective: boolean;
    hasTopic: boolean;
    hasOnline: boolean;
  }
): void {
  if (context.hasRequirement || context.hasSchedule || context.hasTopic) {
    relaxations.set('strict', {
      id: 'strict',
      label: 'Keep all interpreted filters and preferences',
      relaxes: [],
      keeps: ['filters', 'topic'],
    });
  }

  if (context.hasAvoidance || context.hasSubjective) {
    relaxations.set('evidence-backed-workload', {
      id: 'evidence-backed-workload',
      label: 'Show low-workload evidence when exact assignment evidence is missing',
      relaxes: ['lowWriting', 'lowExams', 'lowReading'],
      keeps: ['lowWorkload', 'requirements', 'topic'],
    });
  }

  if (context.hasOnline) {
    relaxations.set('any-delivery', {
      id: 'any-delivery',
      label: 'Keep the GenEd or topic but allow any delivery mode',
      relaxes: ['online'],
      keeps: ['requirements', 'topic', 'workload'],
    });
  }

  if (context.hasRequirement) {
    relaxations.set('adjacent-requirements', {
      id: 'adjacent-requirements',
      label: 'Show adjacent GenEd buckets if exact GenEd matches are sparse',
      relaxes: ['specificRequirement'],
      keeps: ['topic', 'availability'],
    });
  }
}

function cleanDecisionQuery(query: string, removePatterns: RegExp[]): string {
  let cleaned = query;
  for (const pattern of [...removePatterns, ...GENERIC_DECISION_PATTERNS]) {
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

function rescueConfidence(queryTypes: Set<DecisionQueryType>, normalizedRaw: string): number {
  if (queryTypes.has('exact_course')) return 0.95;
  if (queryTypes.size >= 3) return 0.82;
  if (normalizedRaw.length > 0 && queryTypes.size > 0) return 0.74;
  return 0.5;
}

function assumption(kind: string, label: string, confidence: number): SearchPlanAssumption {
  return { kind, label, confidence, source: 'rule' };
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
