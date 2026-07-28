import {
  ANY_GENED_DISPLAY_LABEL,
  formatGenEdDisplayLabel,
  isGenericAnyRequirementFilter,
  type MatchEvidence,
  type MatchEvidenceKind,
  type MatchEvidenceSource,
  type MatchEvidenceWeight,
  type ResultWarning,
  type SearchCourseResultDto,
} from '@uiuc-course-search/query-types';
import { toCourseDto } from '../dto/course.js';
import type { Hint, SearchPlan } from './search-planner-types.js';
import type { SearchResult } from './search-types.js';
import {
  courseRequirementDtoCodes,
  matchingRequirementCodes,
} from './search-requirements.js';

type SearchResultEvidenceContext = {
  plan: SearchPlan;
  rawQuery: string;
  hints?: Hint[];
};

export function presentSearchCourseResult(
  result: SearchResult,
  context?: SearchResultEvidenceContext,
): SearchCourseResultDto {
  return {
    course: toCourseDto(result.course, {
      requirements: result.requirements,
      registrationSummary: result.registrationSummary,
    }),
    matchEvidence: context ? buildMatchEvidence(result, context) : undefined,
    warnings: buildResultWarnings(result),
  };
}

function instructorDifficultyEvidenceLabel(
  difficulty: 'lower' | 'higher',
): string {
  return difficulty === 'lower'
    ? 'Lower instructor-rated difficulty'
    : 'Higher instructor-rated difficulty';
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
  const courseRequirementCodes = courseRequirementDtoCodes(result.requirements);
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

  if (filters.instructorDifficulty) {
    addEvidence(
      evidence,
      seen,
      'instructor_difficulty',
      instructorDifficultyEvidenceLabel(filters.instructorDifficulty),
      'filter',
      'hard',
      filters.instructorDifficulty,
    );
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
