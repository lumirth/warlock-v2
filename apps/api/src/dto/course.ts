import type { Course, Meeting, Section } from '../db/types.js';
import type {
  CourseSectionMeetingDto,
  CourseExplorerUrlInput,
  CourseDto,
  CourseGenedDto,
  CourseSectionDto,
  InstructorLinkDto,
  MatchEvidence,
  MatchEvidenceKind,
  MatchEvidenceSource,
  MatchEvidenceWeight,
  ResultExplanation,
  ResultWarning,
  SectionMatchDto,
} from '@uiuc-course-search/query-types';
import type {
  Hint,
  SearchPlan,
} from '@uiuc-course-search/query-types/search-planner';
import {
  buildCourseExplorerCourseUrl,
  buildCourseExplorerSectionUrl,
  buildRmpProfessorUrl,
  buildRmpSearchUrl,
  effectiveRequirementFilter,
} from '@uiuc-course-search/query-types';
import type { SearchResult } from '../services/search.js';
import { canonicalGenedCode, isGenericAnyGenedFilter } from '../services/gened-codes.js';
import { formatInstructorName, type CourseSnapshot } from '../transforms/course.js';

type CourseSource = Pick<
  Course,
  | 'id'
  | 'subject'
  | 'number'
  | 'title'
  | 'description'
  | 'credit_hours'
  | 'gened'
  | 'year'
  | 'term'
  | 'avg_gpa'
  | 'gpa_sample_size'
  | 'primary_instructor'
  | 'primary_instructor_rmp'
  | 'quality_score'
  | 'difficulty_score'
> & {
  median_gpa?: number | null;
} & Partial<Pick<
  Course,
  | 'course_info'
  | 'degree_attributes'
  | 'class_schedule_info'
  | 'date_range_text'
  | 'registration_notes'
  | 'approval_code'
>>;

type InstructorLinkRow = Partial<{
  instructor_name: string | null;
  rmp_rating: number | null;
  rmp_difficulty: number | null;
  rmp_id: string | null;
  avg_gpa: number | null;
  median_gpa: number | null;
  gpa_sample_size: number | null;
  num_ratings: number | null;
  would_take_again_pct: number | null;
  top_tags: string | string[] | null;
  department: string | null;
}>;

type SectionWithStats = Section & {
  instructor_stats?: InstructorLinkDto[] | null;
  meetings?: SectionMeetingWithStats[] | null;
};

export type CourseDtoOptions = {
  sections?: CourseSectionDto[];
  instructorLinks?: Record<string, InstructorLinkDto>;
  geneds?: CourseGenedDto[];
  medianGpa?: number | null;
  score?: number;
  semanticRank?: number;
  keywordRank?: number;
  historical?: boolean;
  cached?: boolean;
  stale?: boolean;
  staleReason?: string | null;
  ageSeconds?: number;
  fetchedAt?: number;
  termStatus?: string;
  matchEvidence?: MatchEvidence[];
  explanation?: ResultExplanation;
  warnings?: ResultWarning[];
  sectionMatches?: SectionMatchDto[];
};

type SectionMeetingWithStats = Omit<Meeting, 'id'> & {
  id?: Meeting['id'];
  instructor_names?: string | null;
  instructor_stats?: InstructorLinkDto[] | null;
};

function validRmpMetric(value: number | null | undefined, numRatings?: number | null): number | null {
  if (typeof value !== 'number' || value <= 0) return null;
  if (typeof numRatings === 'number' && numRatings <= 0) return null;
  return value;
}

function qualityEvidenceLabel(score: number): string {
  if (score >= 90) return 'Excellent course quality';
  if (score >= 80) return 'Strong course quality';
  if (score >= 70) return 'Good course quality';
  return 'Course quality signal';
}

function difficultyEvidenceLabel(difficulty: 'easy' | 'hard'): string {
  return difficulty === 'easy' ? 'Easier workload fit' : 'Harder workload fit';
}

export type SearchResultEvidenceContext = {
  plan: SearchPlan;
  rawQuery: string;
  hints?: Hint[];
  geneds?: CourseGenedDto[];
};

export function toInstructorLinkDto(row: InstructorLinkRow | null | undefined): InstructorLinkDto {
  const instructorName = row?.instructor_name ?? null;

  return {
    instructor_name: instructorName,
    rmp_rating: validRmpMetric(row?.rmp_rating, row?.num_ratings),
    rmp_difficulty: validRmpMetric(row?.rmp_difficulty, row?.num_ratings),
    rmp_id: row?.rmp_id ?? null,
    rmp_url: buildRmpProfessorUrl(row?.rmp_id),
    rmp_search_url: buildRmpSearchUrl(instructorName),
    avg_gpa: row?.avg_gpa ?? null,
    median_gpa: row?.median_gpa ?? null,
    gpa_sample_size: row?.gpa_sample_size ?? null,
    num_ratings: row?.num_ratings ?? null,
    would_take_again_pct: row?.would_take_again_pct ?? null,
    top_tags: normalizeTopTags(row?.top_tags),
    department: row?.department ?? null,
  };
}

export function toInstructorLinkMap(rows: InstructorLinkRow[]): Record<string, InstructorLinkDto> {
  return Object.fromEntries(
    rows
      .map(toInstructorLinkDto)
      .filter(link => link.instructor_name)
      .map(link => [link.instructor_name as string, link])
  );
}

export function toCourseSectionDto(section: SectionWithStats): CourseSectionDto {
  return {
    crn: section.crn,
    sectionNumber: section.section_number ?? '?',
    status: section.status ?? 'Unknown',
    type: section.type ?? '?',
    days: section.days ?? null,
    startTime: section.start_time ?? null,
    endTime: section.end_time ?? null,
    location: section.location ?? 'TBA',
    instructor: section.instructor ?? 'TBA',
    instructorRmp: validRmpMetric(section.instructor_rmp),
    instructorGpa: section.instructor_gpa ?? null,
    instructorStats: section.instructor_stats ?? [],
    sectionTitle: section.section_title ?? null,
    statusCode: section.status_code ?? null,
    sectionStatusCode: section.section_status_code ?? null,
    sectionText: section.section_text ?? null,
    sectionNotes: section.section_notes ?? null,
    cappArea: section.capp_area ?? null,
    dateRangeText: section.date_range_text ?? null,
    partOfTerm: section.part_of_term ?? null,
    startDate: section.start_date ?? null,
    endDate: section.end_date ?? null,
    creditHours: section.credit_hours ?? null,
    meetings: (section.meetings ?? []).map(toCourseSectionMeetingDto),
    course_explorer_url: buildSectionCourseExplorerUrl(section),
  };
}

function toCourseSectionMeetingDto(meeting: SectionMeetingWithStats): CourseSectionMeetingDto {
  const instructorNames = meeting.instructor_names
    ? meeting.instructor_names.split(';').map(name => name.trim()).filter(Boolean)
    : (meeting.instructor_stats ?? [])
      .map(stat => stat.instructor_name)
      .filter((name): name is string => Boolean(name));

  return {
    typeCode: meeting.type_code ?? null,
    typeName: meeting.type_name ?? null,
    days: meeting.days ?? null,
    startTime: meeting.start_time ?? null,
    endTime: meeting.end_time ?? null,
    buildingName: meeting.building_name ?? null,
    roomNumber: meeting.room_number ?? null,
    dateRangeText: meeting.date_range_text ?? null,
    instructorNames,
    instructors: meeting.instructor_stats ?? [],
  };
}

export function toCourseDto(course: CourseSource, options: CourseDtoOptions = {}): CourseDto {
  return {
    id: course.id,
    subject: course.subject,
    number: course.number,
    title: course.title,
    description: course.description ?? null,
    credit_hours: course.credit_hours ?? null,
    year: course.year,
    term: course.term,
    primary_instructor: course.primary_instructor ?? null,
    primary_instructor_rmp: validRmpMetric(course.primary_instructor_rmp),
    avg_gpa: course.avg_gpa ?? null,
    median_gpa: options.medianGpa ?? course.median_gpa ?? null,
    gpa_sample_size: course.gpa_sample_size ?? null,
    quality_score: course.quality_score ?? null,
    difficulty_score: course.difficulty_score ?? null,
    course_info: course.course_info ?? null,
    degree_attributes: course.degree_attributes ?? null,
    class_schedule_info: course.class_schedule_info ?? null,
    date_range_text: course.date_range_text ?? null,
    registration_notes: course.registration_notes ?? null,
    approval_code: course.approval_code ?? null,
    geneds: options.geneds ?? [],
    instructor_links: options.instructorLinks ?? {},
    course_explorer_url: buildCourseExplorerCourseUrl(course),
    sections: options.sections,
    _score: options.score,
    _semanticRank: options.semanticRank,
    _keywordRank: options.keywordRank,
    _historical: options.historical,
    _cached: options.cached,
    _stale: options.stale,
    _stale_reason: options.staleReason,
    _age_seconds: options.ageSeconds,
    _fetched_at: options.fetchedAt,
    _term_status: options.termStatus,
    match_evidence: options.matchEvidence,
    explanation: options.explanation,
    warnings: options.warnings,
    section_matches: options.sectionMatches,
  };
}

export function courseSnapshotToCourseDto(
  snapshot: CourseSnapshot,
  options: CourseDtoOptions = {}
): CourseDto {
  const {
    sections: providedSections,
    geneds: providedGeneds,
    instructorLinks = {},
    ...courseOptions
  } = options;

  return toCourseDto(snapshot.course, {
    ...courseOptions,
    instructorLinks,
    geneds: providedGeneds ?? snapshotGenedsToDto(snapshot),
    sections: providedSections ?? snapshotSectionsToDto(snapshot, instructorLinks),
  });
}

function snapshotGenedsToDto(snapshot: CourseSnapshot): CourseGenedDto[] {
  return snapshot.genEdCategories.map(gened => ({
    categoryId: gened.categoryId,
    categoryName: gened.categoryName,
    attributeCode: canonicalGenedCode(gened.attributeCode),
    attributeName: gened.attributeName,
  }));
}

function snapshotSectionsToDto(
  snapshot: CourseSnapshot,
  linksMap: Record<string, InstructorLinkDto>
): CourseSectionDto[] {
  return snapshot.sections.map(({ section, meetings }) => {
    const instructorStats = instructorStatsForNames(section.instructor, linksMap);
    const primaryStats = instructorStats[0];

    return toCourseSectionDto({
      ...section,
      instructor_stats: instructorStats,
      instructor_rmp: primaryStats?.rmp_rating ?? section.instructor_rmp,
      instructor_gpa: primaryStats?.avg_gpa ?? section.instructor_gpa,
      meetings: meetings.map(meeting => {
        const instructorNames = meeting.instructors
          .map(formatInstructorName)
          .filter((name): name is string => Boolean(name));

        return {
          ...meeting,
          instructor_names: instructorNames.join(';'),
          instructor_stats: instructorNames.map(name => linksMap[name]).filter(Boolean),
        };
      }),
    });
  });
}

function instructorStatsForNames(
  instructorNames: string | null | undefined,
  linksMap: Record<string, InstructorLinkDto>
): InstructorLinkDto[] {
  const names = instructorNames
    ? instructorNames.split(';').map(name => name.trim()).filter(Boolean)
    : [];
  return names.map(name => linksMap[name]).filter(Boolean);
}

function normalizeTopTags(value: string | string[] | null | undefined): string[] | null {
  if (Array.isArray(value)) {
    const tags = value.map(tag => tag.trim()).filter(Boolean);
    return tags.length > 0 ? tags : null;
  }

  if (!value) return null;

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      const tags = parsed.map(item => String(item).trim()).filter(Boolean);
      return tags.length > 0 ? tags : null;
    }
  } catch {
    // Fall back to delimiter parsing below.
  }

  const tags = value
    .split(/[,;|]/)
    .map(tag => tag.trim())
    .filter(Boolean);
  return tags.length > 0 ? tags : null;
}

function parseCourseId(value: string): CourseExplorerUrlInput | null {
  const match = /^([A-Z]+)-([0-9]{3})-([0-9]{4})-(winter|spring|summer|fall)$/i.exec(value);
  if (!match) {
    return null;
  }

  return {
    subject: match[1],
    number: match[2],
    year: parseInt(match[3], 10),
    term: match[4],
  };
}

function buildSectionCourseExplorerUrl(section: SectionWithStats): string | undefined {
  const courseParts = parseCourseId(section.course_id);
  if (!courseParts) {
    return undefined;
  }

  return buildCourseExplorerSectionUrl({
    ...courseParts,
    crn: section.crn,
  });
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
  value?: string
): void {
  const key = `${kind}:${label}:${value ?? ''}`;
  if (seen.has(key)) return;
  seen.add(key);
  evidence.push({ kind, label, source, weight, value });
}

function hasHint(hints: Hint[] | undefined, type: Hint['type']): boolean {
  return hints?.some(hint => hint.type === type) ?? false;
}

function hasStructuredRequirementEvidence(result: SearchResult): boolean {
  return Boolean(result.laneMatches?.includes('requirement') && result.course.gened);
}

export function buildMatchEvidence(
  result: SearchResult,
  context: SearchResultEvidenceContext
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

  const requirement = effectiveRequirementFilter(filters);
  const genedFilters = requirement?.codes ?? [];
  if (genedFilters.length > 0) {
    const isGenericGened = requirement?.mode === 'any' && isGenericAnyGenedFilter(requirement.codes);
    addEvidence(
      evidence,
      seen,
      'gened',
      isGenericGened ? 'Any GenEd' : `GenEd ${genedFilters.join(', ')}`,
      'filter',
      'hard',
      course.gened ?? (isGenericGened ? 'mapped requirement' : genedFilters.join(','))
    );
  } else if (hasHint(context.hints, 'gened') && course.gened) {
    addEvidence(evidence, seen, 'gened', `GenEd ${course.gened}`, 'query', 'soft', course.gened);
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
      String(filters.online)
    );
  }

  if (filters.instructor_ids?.length || hasHint(context.hints, 'instructor')) {
    addEvidence(evidence, seen, 'instructor', 'Instructor match', 'filter', 'hard', course.primary_instructor ?? undefined);
  }

  if (filters.difficulty) {
    addEvidence(evidence, seen, 'difficulty', difficultyEvidenceLabel(filters.difficulty), 'filter', 'soft', filters.difficulty);
    if (typeof course.quality_score === 'number') {
      addEvidence(evidence, seen, 'quality', qualityEvidenceLabel(course.quality_score), 'metadata', 'soft', course.quality_score.toFixed(0));
    }
  }

  if (result.laneMatches?.includes('student_language_alias')) {
    addEvidence(evidence, seen, 'alias', 'Student-language alias match', 'alias', 'rank');
  }

  if (result.laneMatches?.includes('workload_evidence')) {
    const claims = result.supportedSubjectiveClaims?.length
      ? result.supportedSubjectiveClaims.join(', ')
      : undefined;
    addEvidence(evidence, seen, 'workload', 'Workload evidence match', 'signal', 'soft', claims);
  }

  if (result.laneMatches?.includes('requirement') && course.gened) {
    addEvidence(evidence, seen, 'gened', `GenEd ${course.gened}`, 'filter', 'soft', course.gened);
  }

  if (result.laneMatches?.includes('structured_section')) {
    addEvidence(evidence, seen, 'schedule', 'Section availability or schedule match', 'filter', 'soft');
  }

  if (softPreferences?.levelBoost) {
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
      `${course.term} ${course.year}`
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

export function buildResultWarnings(result: SearchResult): ResultWarning[] {
  const warnings: ResultWarning[] = [];
  if (result.historical) {
    warnings.push({ kind: 'historical', message: 'Historical term result' });
  }
  return warnings;
}

export function buildResultExplanation(
  result: SearchResult,
  context: SearchResultEvidenceContext,
  evidence: MatchEvidence[],
  warnings: ResultWarning[]
): ResultExplanation {
  const rescue = context.plan.rescue;
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
  const whyMatched = Array.from(new Set([
    ...evidenceReasons,
    ...rankingReasons,
  ])).slice(0, 7);

  const watchOut = [
    ...warnings.map(warning => warning.message),
    ...(rescue?.warnings.map(warning => warning.message) ?? []),
    ...(result.scoreComponents
      ?.filter(component => component.value < 0)
      .map(component => component.reason) ?? []),
  ];

  if (
    rescue?.queryTypes.some(type => type === 'subjective_vibe' || type === 'avoidance')
    && !result.laneMatches?.includes('workload_evidence')
    && !result.supportedSubjectiveClaims?.length
  ) {
    watchOut.push('Subjective preferences are not fully backed by assignment-level evidence for this course.');
  }

  const matchedChips = rescue?.assumptions.map(item => item.label) ?? [];
  const confidenceScore = explanationConfidenceScore(result, context.plan);
  const confidenceLabel: ResultExplanation['confidence']['label'] =
    confidenceScore >= 0.82 ? 'high'
      : confidenceScore >= 0.62 ? 'medium'
        : confidenceScore >= 0.42 ? 'low'
          : 'uncertain';

  return {
    whyMatched,
    watchOut: Array.from(new Set(watchOut)).slice(0, 6),
    matchedChips,
    confidence: {
      score: confidenceScore,
      label: confidenceLabel,
      reasons: explanationConfidenceReasons(result, context.plan),
    },
  };
}

function explanationConfidenceScore(result: SearchResult, plan: SearchPlan): number {
  let score = plan.rescue?.confidence ?? 0.72;
  if (result.laneMatches?.includes('exact')) score += 0.12;
  if (hasStructuredRequirementEvidence(result)) score += 0.08;
  if (result.laneMatches?.includes('structured_section')) score += 0.05;
  if (result.laneMatches?.includes('workload_evidence')) score += 0.1;
  if (
    plan.rescue?.queryTypes.some(type => type === 'subjective_vibe' || type === 'avoidance')
    && !result.laneMatches?.includes('workload_evidence')
    && !result.supportedSubjectiveClaims?.length
  ) {
    score -= 0.22;
  }
  return Math.max(0.1, Math.min(0.98, Number(score.toFixed(2))));
}

function explanationConfidenceReasons(result: SearchResult, plan: SearchPlan): string[] {
  const reasons: string[] = [];
  if (result.laneMatches?.includes('exact')) reasons.push('Exact course lookup is structured.');
  if (hasStructuredRequirementEvidence(result)) reasons.push('Requirement evidence came from structured mappings.');
  if (result.laneMatches?.includes('structured_section')) reasons.push('Schedule or availability evidence came from section data.');
  if (result.laneMatches?.includes('workload_evidence')) reasons.push('Subjective workload preference has an evidence signal.');
  if (
    plan.rescue?.queryTypes.some(type => type === 'subjective_vibe' || type === 'avoidance')
    && !result.laneMatches?.includes('workload_evidence')
  ) {
    reasons.push('Subjective workload evidence is incomplete for this course.');
  }
  return reasons.length > 0 ? reasons : ['Matched by course text and structured filters.'];
}

export function searchResultToCourseDto(result: SearchResult, context?: SearchResultEvidenceContext): CourseDto {
  const matchEvidence = context ? buildMatchEvidence(result, context) : undefined;
  const warnings = buildResultWarnings(result);
  return toCourseDto(result.course, {
    score: result.score,
    semanticRank: result.semanticRank,
    keywordRank: result.keywordRank,
    historical: result.historical,
    geneds: context?.geneds,
    matchEvidence,
    explanation: context && matchEvidence ? buildResultExplanation(result, context, matchEvidence, warnings) : undefined,
    warnings,
  });
}
