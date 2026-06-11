import {
  ANY_GENED_DISPLAY_LABEL,
  formatGenEdDisplayLabel,
  getQualityTierLabel,
  isGenericAnyRequirementFilter,
  type MatchEvidence,
  type MatchEvidenceKind,
  type MatchEvidenceSource,
  type MatchEvidenceWeight,
  type ResultExplanation,
  type ResultWarning,
  type SearchCourseResultDto,
} from '@uiuc-course-search/query-types';
import { toCourseDto } from '../dto/course.js';
import type { Hint, SearchPlan } from './search-planner-types.js';
import type { SearchResult } from './search-types.js';
import {
  matchingRequirementCodes,
  searchResultRequirementCodes,
} from './search-requirements.js';

type SearchResultEvidenceContext = {
  plan: SearchPlan;
  rawQuery: string;
  hints?: Hint[];
};

type SearchResultPresentation = {
  matchEvidence?: MatchEvidence[];
  explanation?: ResultExplanation;
  warnings: ResultWarning[];
};

export function presentSearchCourseResult(
  result: SearchResult,
  context?: SearchResultEvidenceContext,
): SearchCourseResultDto {
  const presentation = buildSearchResultPresentation(result, context);
  return {
    course: toCourseDto(result.course, {
      requirements: result.requirements,
    }),
    matchEvidence: presentation.matchEvidence,
    explanation: presentation.explanation,
    warnings: presentation.warnings,
  };
}

function buildSearchResultPresentation(
  result: SearchResult,
  context?: SearchResultEvidenceContext,
): SearchResultPresentation {
  const warnings = buildResultWarnings(result);
  const matchEvidence = context ? buildMatchEvidence(result, context) : undefined;

  return {
    warnings,
    matchEvidence,
    explanation: context && matchEvidence
      ? buildResultExplanation(result, context, matchEvidence, warnings)
      : undefined,
  };
}

function qualityEvidenceLabel(score: number): string {
  const label = getQualityTierLabel(score);
  return label ? `${label} quality tier` : 'Course quality signal';
}

function workloadEvidenceLabel(workload: 'easy' | 'hard'): string {
  return workload === 'easy' ? 'Easier workload fit' : 'Harder workload fit';
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizeCompact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function addEvidence(
  evidence: MatchEvidence[],
  seen: Set<string>,
  kind: MatchEvidenceKind,
  label: string,
  source: MatchEvidenceSource,
  weight: MatchEvidenceWeight,
  value?: string,
): void {
  const key = `${kind}:${label}:${value ?? ''}`;
  if (seen.has(key)) return;
  seen.add(key);
  evidence.push({ kind, label, source, weight, value });
}

function hasHint(hints: Hint[] | undefined, type: Hint['type']): boolean {
  return hints?.some(hint => hint.type === type) ?? false;
}

function resultRequirementCodes(
  result: SearchResult,
): string[] {
  return searchResultRequirementCodes(result);
}

function hasStructuredRequirementEvidence(
  result: SearchResult,
  plan: SearchPlan,
): boolean {
  const requested = plan.filters.requirement;
  return Boolean(
    requested
    && matchingRequirementCodes(
      resultRequirementCodes(result),
      requested.codes,
    ).length > 0,
  );
}

function hasStructuredSectionEvidence(plan: SearchPlan): boolean {
  const { filters } = plan;
  return Boolean(
    filters.online !== undefined
    || filters.days
    || filters.time
    || filters.status
    || filters.partOfTerm
    || filters.compressedTerm
    || filters.startAfterMinutes !== undefined
    || filters.startBeforeMinutes !== undefined,
  );
}

function buildMatchEvidence(
  result: SearchResult,
  context: SearchResultEvidenceContext,
): MatchEvidence[] {
  const { course } = result;
  const { filters, softPreferences } = context.plan;
  const evidence: MatchEvidence[] = [];
  const seen = new Set<string>();
  const courseCode = `${course.subject} ${course.number}`;
  const normalizedRaw = normalizeText(context.rawQuery);
  const compactRaw = normalizeCompact(context.rawQuery);
  const normalizedTitle = normalizeText(course.title);

  const exactCourseCode =
    (filters.subject === course.subject && filters.number === course.number)
    || normalizedRaw.includes(normalizeText(courseCode))
    || compactRaw.includes(normalizeCompact(courseCode));

  if (exactCourseCode) {
    addEvidence(evidence, seen, 'course_code', `Course ${courseCode}`, 'filter', 'hard', courseCode);
  } else {
    if (filters.subject === course.subject) {
      addEvidence(evidence, seen, 'subject', `Subject ${course.subject}`, 'filter', 'hard', course.subject);
    }
    if (filters.number === course.number) {
      addEvidence(evidence, seen, 'number', `Number ${course.number}`, 'filter', 'hard', course.number);
    }
  }

  if (filters.crn) {
    addEvidence(evidence, seen, 'crn', `CRN ${filters.crn}`, 'filter', 'hard', filters.crn);
  }

  if (normalizedRaw && normalizedTitle && (normalizedRaw.includes(normalizedTitle) || normalizedTitle.includes(normalizedRaw))) {
    addEvidence(evidence, seen, 'title', `Title match: ${course.title}`, 'keyword', 'rank', course.title);
  }

  const requirement = filters.requirement;
  const requirementFilters = requirement?.codes ?? [];
  const courseRequirementCodes = resultRequirementCodes(result);
  if (requirementFilters.length > 0) {
    const isGenericRequirement = requirement?.mode === 'any' && isGenericAnyRequirementFilter(requirement.codes);
    const matchedCodes = matchingRequirementCodes(courseRequirementCodes, requirementFilters);
    if (matchedCodes.length > 0) {
      addEvidence(
        evidence,
        seen,
        'requirement',
        isGenericRequirement ? ANY_GENED_DISPLAY_LABEL : formatGenEdDisplayLabel(requirementFilters),
        'filter',
        'hard',
        matchedCodes.join(', '),
      );
    }
  } else if (hasHint(context.hints, 'requirement') && courseRequirementCodes.length > 0) {
    const value = courseRequirementCodes.join(', ');
    addEvidence(evidence, seen, 'requirement', formatGenEdDisplayLabel(courseRequirementCodes), 'query', 'soft', value);
  }

  if (filters.days) {
    addEvidence(evidence, seen, 'schedule', `${filters.days} schedule`, 'filter', 'hard', filters.days);
  }
  if (filters.time) {
    addEvidence(evidence, seen, 'schedule', `${filters.time} time`, 'filter', 'hard', filters.time);
  }
  if (filters.partOfTerm) {
    addEvidence(evidence, seen, 'schedule', `Part of term ${filters.partOfTerm}`, 'filter', 'hard', filters.partOfTerm);
  }
  if (filters.status) {
    addEvidence(evidence, seen, 'schedule', `${filters.status} sections`, 'filter', 'hard', filters.status);
  }

  if (filters.online !== undefined) {
    addEvidence(
      evidence,
      seen,
      'delivery',
      filters.online ? 'Online delivery' : 'In-person delivery',
      'filter',
      'hard',
      String(filters.online),
    );
  }

  if (filters.instructor_ids?.length || hasHint(context.hints, 'instructor')) {
    addEvidence(evidence, seen, 'instructor', 'Instructor match', 'filter', 'hard', course.primary_instructor ?? undefined);
  }

  if (filters.workload) {
    addEvidence(evidence, seen, 'workload', workloadEvidenceLabel(filters.workload), 'filter', 'soft', filters.workload);
    if (typeof course.quality_score === 'number') {
      addEvidence(evidence, seen, 'quality', qualityEvidenceLabel(course.quality_score), 'metadata', 'soft', course.quality_score.toFixed(0));
    }
  }

  if (softPreferences?.levelBoost && context.plan.introductoryGateway === true) {
    const levelLabel = softPreferences.levelBoost === 100
      ? 'Introductory course'
      : `${softPreferences.levelBoost} level preference`;
    addEvidence(evidence, seen, 'topic', levelLabel, 'query', 'soft', String(softPreferences.levelBoost));
  }

  if (filters.term || filters.year) {
    addEvidence(
      evidence,
      seen,
      'term',
      [filters.term, filters.year].filter(Boolean).join(' '),
      'term',
      'hard',
      `${course.term} ${course.year}`,
    );
  }

  if (result.keywordRank !== undefined) {
    const label = result.keywordRank === 1 ? 'Strong keyword match' : 'Keyword match';
    addEvidence(evidence, seen, 'keyword', label, 'keyword', 'rank', String(result.keywordRank));
  }
  if (result.semanticRank !== undefined) {
    const label = result.semanticRank === 1 ? 'Strong topic match' : 'Related topic match';
    addEvidence(evidence, seen, 'semantic', label, 'semantic', 'rank', String(result.semanticRank));
  }

  return evidence;
}

function buildResultWarnings(result: SearchResult): ResultWarning[] {
  const warnings: ResultWarning[] = [];
  if (result.historical) {
    warnings.push({ kind: 'historical', message: 'Historical term result' });
  }
  return warnings;
}

function buildResultExplanation(
  result: SearchResult,
  context: SearchResultEvidenceContext,
  evidence: MatchEvidence[],
  warnings: ResultWarning[],
): ResultExplanation {
  const intent = context.plan.intent;
  const evidenceReasons = evidence
    .slice(0, 7)
    .map(item => item.value ? `${item.label}: ${item.value}` : item.label);
  const rankingReasons = result.scoreComponents
    ?.filter(component => component.value > 0 && component.name !== 'retrieval_fusion')
    .sort((left, right) => Math.abs(right.value) - Math.abs(left.value))
    .map(component => component.evidence?.length
      ? `${component.reason}: ${component.evidence.slice(0, 2).join(', ')}`
      : component.reason
    ) ?? [];
  const orderingReasons = result.scoreComponents
    ?.filter(component => component.name === 'attribute_sort' || component.name === 'term_tie_breaker')
    .map(component => component.evidence?.length
      ? `${component.reason}: ${component.evidence.slice(0, 2).join(', ')}`
      : component.reason
    ) ?? [];
  const whyMatched = Array.from(new Set([
    ...evidenceReasons,
    ...rankingReasons,
    ...orderingReasons,
  ])).slice(0, 7);

  const watchOut = [
    ...warnings.map(warning => warning.message),
    ...(intent?.warnings.map(warning => warning.message) ?? []),
    ...(result.scoreComponents
      ?.filter(component => component.value < 0)
      .map(component => component.reason) ?? []),
  ];

  if (
    intent?.queryTypes.some(type => type === 'subjective_vibe' || type === 'avoidance')
    && !hasVisibleSubjectiveEvidence(result)
  ) {
    watchOut.push('Subjective preferences are not fully backed by assignment-level evidence for this course.');
  }

  const confidenceScore = explanationConfidenceScore(result, context);
  const confidenceLabel: ResultExplanation['confidence']['label'] =
    confidenceScore >= 0.82 ? 'high'
      : confidenceScore >= 0.62 ? 'medium'
        : confidenceScore >= 0.42 ? 'low'
          : 'uncertain';

  return {
    whyMatched,
    watchOut: Array.from(new Set(watchOut)).slice(0, 6),
    confidence: {
      score: confidenceScore,
      label: confidenceLabel,
      reasons: explanationConfidenceReasons(result, context),
    },
  };
}

function explanationConfidenceScore(result: SearchResult, context: SearchResultEvidenceContext): number {
  const { plan } = context;
  let score = plan.intent?.confidence ?? 0.72;
  if (result.laneMatches?.includes('exact')) score += 0.12;
  if (hasStructuredRequirementEvidence(result, plan)) score += 0.08;
  score -= missingRequirementEvidencePenalty(result, plan);
  if (hasStructuredSectionEvidence(plan)) score += 0.05;
  if (hasVisibleSubjectiveEvidence(result)) score += 0.08;
  score -= incompleteEvidencePenalty(plan);
  if (
    plan.intent?.queryTypes.some(type => type === 'subjective_vibe' || type === 'avoidance')
    && !hasVisibleSubjectiveEvidence(result)
  ) {
    score -= 0.22;
  }
  return Math.max(0.1, Math.min(0.98, Number(score.toFixed(2))));
}

function explanationConfidenceReasons(result: SearchResult, context: SearchResultEvidenceContext): string[] {
  const { plan } = context;
  const reasons: string[] = [];
  if (result.laneMatches?.includes('exact')) reasons.push('Exact course lookup is structured.');
  if (hasStructuredRequirementEvidence(result, plan)) reasons.push('GenEd evidence came from structured mappings.');
  if (hasMissingRequirementEvidence(result, plan)) reasons.push('Requested requirement has no visible mapping for this course.');
  if (hasStructuredSectionEvidence(plan)) reasons.push('Schedule or availability evidence came from section data.');
  if (hasVisibleSubjectiveEvidence(result)) reasons.push('Visible workload, quality, or GPA data supports the explanation.');
  if (plan.intent?.warnings.length) reasons.push('Some inferred preferences have incomplete evidence.');
  if (
    plan.intent?.queryTypes.some(type => type === 'subjective_vibe' || type === 'avoidance')
    && !hasVisibleSubjectiveEvidence(result)
  ) {
    reasons.push('Subjective workload evidence is incomplete for this course.');
  }
  return reasons.length > 0 ? reasons : ['Matched by course text and structured filters.'];
}

function incompleteEvidencePenalty(plan: SearchPlan): number {
  const warningCount = plan.intent?.warnings.length ?? 0;
  return warningCount > 0
    ? Math.min(0.4, 0.25 + (warningCount - 1) * 0.08)
    : 0;
}

function missingRequirementEvidencePenalty(
  result: SearchResult,
  plan: SearchPlan,
): number {
  return hasMissingRequirementEvidence(result, plan) ? 0.18 : 0;
}

function hasMissingRequirementEvidence(
  result: SearchResult,
  plan: SearchPlan,
): boolean {
  const hasRequirementIntent = Boolean(
    plan.filters.requirement
    || plan.intent?.queryTypes.some(type => type === 'requirement' || type === 'degree_progress'),
  );
  return hasRequirementIntent && resultRequirementCodes(result).length === 0;
}

function hasVisibleSubjectiveEvidence(result: SearchResult): boolean {
  return typeof result.course.quality_score === 'number'
    || typeof result.course.difficulty_score === 'number'
    || typeof result.course.avg_gpa === 'number';
}
