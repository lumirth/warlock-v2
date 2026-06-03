import type {
  DecisionQueryType,
  RetrievalLane,
  SearchPlan,
  SearchPlanAssumption,
  SearchPlanWarning,
  SearchPlanWarningKind,
  SearchRelaxationStep,
} from '@uiuc-course-search/query-types';
import { GENERIC_GENED_CODES } from './gened-codes.js';

type RescueRule = {
  queryTypes: DecisionQueryType[];
  patterns: RegExp[];
  removePatterns?: RegExp[];
  negativeTerms?: string[];
  softPreferences?: Record<string, unknown>;
  assumptions?: SearchPlanAssumption[];
  warnings?: SearchPlanWarning[];
};

type TimePreference = {
  key: 'startAfterMinutes' | 'startBeforeMinutes';
  value: number;
  raw: string;
};

export interface DecisionSearchRescueResult {
  queryResidual: string;
}

const GENERIC_DECISION_PATTERNS = [
  /\bi\s+(?:need|want|am looking for|m looking for)\b/gi,
  /\b(?:need|want|looking for)\b/gi,
  /\b(?:a|an|the)\b/gi,
  /\b(?:does|this)\b/gi,
  /\bcounts?\s+for\b/gi,
  /\b(?:that|which)\s+counts?\b/gi,
  /\b(?:class|classes|course|courses)\b/gi,
  /\b(?:please|show me|find me)\b/gi,
];

const RESCUE_RULES: RescueRule[] = [
  {
    queryTypes: ['avoidance', 'subjective_vibe'],
    patterns: [/\bno\s+(?:essays?|papers?|writing)\b/i, /\bnot\s+writing\s+heavy\b/i, /\b(?:low|light|writing[-\s]+light)\s+writing\b/i, /\bwriting[-\s]+light\b/i],
    negativeTerms: ['writing_heavy', 'essays', 'papers'],
    softPreferences: { lowWriting: 0.9 },
    assumptions: [assumption('low_writing', 'Low writing preferred', 0.82)],
    warnings: [warning('writing_evidence_incomplete', 'Essay and writing workload evidence is incomplete for many courses.', 0.78)],
  },
  {
    queryTypes: ['avoidance', 'subjective_vibe'],
    patterns: [/\bno\s+(?:exams?|tests?|midterms?|finals?)\b/i, /\blow\s+exam\b/i],
    negativeTerms: ['exam_heavy', 'tests', 'exams'],
    softPreferences: { lowExams: 0.88 },
    assumptions: [assumption('low_exams', 'Low exam load preferred', 0.78)],
    warnings: [warning('exam_evidence_incomplete', 'Exam workload evidence usually comes from syllabi or student reports, not catalog text.', 0.74)],
  },
  {
    queryTypes: ['avoidance', 'subjective_vibe'],
    patterns: [/\bnot\s+math(?:[-\s]+heavy)?\b/i, /\bno\s+math\b/i, /\bi\s+hate\s+math\b/i, /\blow\s+math\b/i],
    negativeTerms: ['math_heavy', 'calculus', 'statistics', 'formal_logic', 'quantitative'],
    softPreferences: { lowMath: 0.86 },
    assumptions: [assumption('low_math', 'Avoid math-heavy courses', 0.78)],
    warnings: [warning('math_risk_inferred', 'Math-heavy risk is inferred from course language and requirements until syllabus evidence is available.', 0.72)],
  },
  {
    queryTypes: ['eligibility'],
    patterns: [/\bno\s+(?:listed\s+)?prereq(?:uisite)?s?\b/i, /\bwithout\s+prereq(?:uisite)?s?\b/i],
    negativeTerms: ['prerequisites', 'restricted_access'],
    softPreferences: { noListedPrereq: true },
    assumptions: [assumption('no_listed_prereq', 'No listed prerequisite preferred', 0.82)],
    warnings: [warning('prereq_evidence_incomplete', 'Prerequisite and restriction text can be incomplete or term-specific.', 0.7)],
  },
  {
    queryTypes: ['subjective_vibe'],
    patterns: [/\b(?:easy|chill|gpa\s+booster|grade\s+booster|easy\s+a|low\s+workload)\b/i],
    softPreferences: { lowWorkload: 0.84 },
    assumptions: [assumption('low_workload', 'Low workload preferred', 0.82)],
    warnings: [warning('workload_evidence_incomplete', 'Workload is estimated from scores and available evidence, not guaranteed.', 0.72)],
  },
  {
    queryTypes: ['subjective_vibe'],
    patterns: [/\b(?:fun|interesting|cool)\b/i],
    softPreferences: { fun: 0.55 },
    assumptions: [assumption('fun_or_interesting', 'Fun or interesting topic preferred', 0.52)],
  },
  {
    queryTypes: ['avoidance'],
    patterns: [/\bless\s+bio(?:logy)?\b/i, /\bnot\s+bio(?:logy)?(?:[-\s]+heavy)?\b/i, /\bno\s+bio(?:logy)?\b/i],
    negativeTerms: ['biology_heavy', 'bio'],
    softPreferences: { lowBiology: 0.72 },
    assumptions: [assumption('low_biology', 'Avoid biology-heavy courses', 0.68)],
  },
  {
    queryTypes: ['avoidance'],
    patterns: [/\bno\s+group\s+projects?\b/i, /\bavoid\s+group\s+projects?\b/i],
    negativeTerms: ['group_projects'],
    softPreferences: { lowGroupWork: 0.8 },
    assumptions: [assumption('avoid_group_projects', 'Avoid group projects', 0.76)],
    warnings: [warning('workload_evidence_incomplete', 'Group-project evidence usually requires syllabi or student reports.', 0.68)],
  },
  {
    queryTypes: ['subjective_vibe'],
    patterns: [/\blow\s+reading\b/i, /\bminimal\s+reading\b/i],
    negativeTerms: ['reading_heavy'],
    softPreferences: { lowReading: 0.78 },
    assumptions: [assumption('low_reading', 'Low reading load preferred', 0.72)],
    warnings: [warning('workload_evidence_incomplete', 'Reading workload evidence is incomplete for many courses.', 0.68)],
  },
];

const REQUIREMENT_PATTERNS = [
  /\bgen\s*-?\s*ed\b/i,
  /\brequirements?\b/i,
  /\bcounts?\s+for\b/i,
  /\bthat\s+counts?\b/i,
  /\bcounts?\b/i,
  /\bfulfills?\b/i,
  /\bdouble\s+count/i,
  /\btwo\s+requirements?\b/i,
];

const GENERIC_GENED_PATTERNS = [
  /\bgen\s*-?\s*ed\b/i,
  /\bgened\b/i,
];

const STUDENT_PROFILE_PATTERNS = [
  /\bcounts?\s+for\b/i,
  /\bcounts?\s+for\s+something\b/i,
  /\bthat\s+counts?\b/i,
  /\bdouble\s+count/i,
  /\btwo\s+requirements?\b/i,
  /\bwhat\s+(?:do\s+)?i\s+need\b/i,
  /\bwhat\s+(?:am\s+)?i\s+missing\b/i,
  /\bdegree\s+(?:audit|progress|requirements?)\b/i,
];

const HELP_PATTERNS = [
  /\bhow\s+do\s+i\b/i,
  /\bwhat\s+should\s+i\s+take\b/i,
  /\bhow\s+to\b/i,
  /\bhelp\b/i,
];

const COMPARISON_PATTERNS = [
  /\blike\s+[A-Z]{2,4}\s*\d{3}\b/i,
  /\bsimilar\s+to\b/i,
];

const COMPRESSED_TERM_PATTERNS = [
  /\b8\s*-?\s*week\b/i,
  /\beight\s*-?\s*week\b/i,
  /\bfirst\s+half\b/i,
  /\bsecond\s+half\b/i,
];

const NON_MAJOR_PATTERNS = [
  /\bnon[-\s]?majors?\b/i,
  /\bfor\s+non[-\s]?majors?\b/i,
  /\bfreshman\b/i,
];

const ASYNC_PATTERNS = [
  /\basync(?:hronous)?\b/i,
  /\bself[-\s]?paced\b/i,
];

export function applyDecisionSearchRescue(
  plan: SearchPlan,
  rawQuery: string,
  queryResidual: string
): DecisionSearchRescueResult {
  const queryTypes = new Set<DecisionQueryType>();
  const negativeTerms = new Set<string>();
  const assumptions = new Map<string, SearchPlanAssumption>();
  const warnings = new Map<SearchPlanWarningKind, SearchPlanWarning>();
  const retrievalLanes = new Set<RetrievalLane>();
  const relaxations = new Map<string, SearchRelaxationStep>();
  const removePatterns: RegExp[] = [];
  const normalizedRaw = rawQuery.toLowerCase();

  for (const rule of RESCUE_RULES) {
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

  if (hasGenericGenedIntent(rawQuery) && !hasGenedFilter(plan)) {
    plan.filters.gened_any = [...GENERIC_GENED_CODES];
  }

  if (hasRequirementIntent(plan, rawQuery)) {
    queryTypes.add('requirement');
    assumptions.set('requirement_match', assumption('requirement_match', 'Requirement match matters', 0.78));
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

  if (plan.filters.difficulty === 'easy') {
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

  addRetrievalLanes(retrievalLanes, queryTypes);
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
    retrievalLanes: Array.from(retrievalLanes),
    relaxationPlan: Array.from(relaxations.values()),
    needsStudentProfile,
    confidence: rescueConfidence(queryTypes, normalizedRaw),
  };

  return { queryResidual: nextResidual };
}

export function syncDecisionSearchExpansions(plan: SearchPlan, expansions: string[]): void {
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
  return hasGenedFilter(plan)
    || REQUIREMENT_PATTERNS.some(pattern => pattern.test(rawQuery));
}

function hasGenedFilter(plan: SearchPlan): boolean {
  return Boolean(plan.filters.gened_code || plan.filters.gened_any?.length || plan.filters.gened_all?.length);
}

function hasGenericGenedIntent(rawQuery: string): boolean {
  return GENERIC_GENED_PATTERNS.some(pattern => pattern.test(rawQuery));
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

function addRetrievalLanes(lanes: Set<RetrievalLane>, queryTypes: Set<DecisionQueryType>): void {
  if (queryTypes.has('exact_course')) lanes.add('exact');
  if (queryTypes.has('topic') || queryTypes.has('requirement') || queryTypes.has('comparison')) lanes.add('official_text');
  if (queryTypes.has('requirement') || queryTypes.has('degree_progress')) lanes.add('requirement');
  if (queryTypes.has('schedule')) lanes.add('structured_section');
  if (queryTypes.has('subjective_vibe') || queryTypes.has('avoidance')) lanes.add('student_language_alias');
  if (queryTypes.has('topic') || queryTypes.has('comparison')) lanes.add('topic_semantic');
  if (queryTypes.has('subjective_vibe') || queryTypes.has('avoidance') || queryTypes.has('eligibility')) lanes.add('workload_evidence');
  if (queryTypes.has('help_or_how_to') || queryTypes.has('degree_progress')) lanes.add('help_path');
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
      label: 'Keep the requirement or topic but allow any delivery mode',
      relaxes: ['online'],
      keeps: ['requirements', 'topic', 'workload'],
    });
  }

  if (context.hasRequirement) {
    relaxations.set('adjacent-requirements', {
      id: 'adjacent-requirements',
      label: 'Show adjacent requirement buckets if exact requirement matches are sparse',
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

function assumption(kind: string, label: string, confidence: number): SearchPlanAssumption {
  return { kind, label, confidence, source: 'rule' };
}

function warning(kind: SearchPlanWarningKind, message: string, confidence: number): SearchPlanWarning {
  return { kind, message, confidence };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
