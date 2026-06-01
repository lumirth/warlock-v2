import type { Course, Section } from '../db/index.js';
import type {
  CourseDto,
  CourseSectionDto,
  Hint,
  InstructorLinkDto,
  MatchEvidence,
  MatchEvidenceKind,
  MatchEvidenceSource,
  MatchEvidenceWeight,
  ResultWarning,
  SearchPlan,
  SectionMatchDto,
} from '@uiuc-course-search/query-types';
import type { SearchResult } from '../services/search.js';

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
>;

type InstructorLinkRow = Partial<{
  instructor_name: string | null;
  rmp_rating: number | null;
  rmp_difficulty: number | null;
  rmp_id: string | null;
  avg_gpa: number | null;
  gpa_sample_size: number | null;
  num_ratings: number | null;
}>;

type SectionWithStats = Section & {
  instructor_stats?: InstructorLinkDto[] | null;
};

export type CourseDtoOptions = {
  sections?: CourseSectionDto[];
  instructorLinks?: Record<string, InstructorLinkDto>;
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
  warnings?: ResultWarning[];
  sectionMatches?: SectionMatchDto[];
};

export type SearchResultEvidenceContext = {
  plan: SearchPlan;
  rawQuery: string;
  hints?: Hint[];
};

export function toInstructorLinkDto(row: InstructorLinkRow | null | undefined): InstructorLinkDto {
  return {
    instructor_name: row?.instructor_name ?? null,
    rmp_rating: row?.rmp_rating ?? null,
    rmp_difficulty: row?.rmp_difficulty ?? null,
    rmp_id: row?.rmp_id ?? null,
    avg_gpa: row?.avg_gpa ?? null,
    gpa_sample_size: row?.gpa_sample_size ?? null,
    num_ratings: row?.num_ratings ?? null,
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
    instructorRmp: section.instructor_rmp ?? null,
    instructorGpa: section.instructor_gpa ?? null,
    instructorStats: section.instructor_stats ?? [],
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
    gened: course.gened ?? null,
    year: course.year,
    term: course.term,
    primary_instructor: course.primary_instructor ?? null,
    primary_instructor_rmp: course.primary_instructor_rmp ?? null,
    avg_gpa: course.avg_gpa ?? null,
    gpa_sample_size: course.gpa_sample_size ?? null,
    quality_score: course.quality_score ?? null,
    difficulty_score: course.difficulty_score ?? null,
    instructor_links: options.instructorLinks ?? {},
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
    warnings: options.warnings,
    section_matches: options.sectionMatches,
  };
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

  if (normalizedTitle && (normalizedRaw.includes(normalizedTitle) || normalizedTitle.includes(normalizedRaw))) {
    addEvidence(evidence, seen, 'title', `Title match: ${course.title}`, 'keyword', 'rank', course.title);
  }

  const genedFilters = [
    filters.gened_code,
    ...(filters.gened_any ?? []),
    ...(filters.gened_all ?? []),
  ].filter((value): value is string => Boolean(value));
  if (genedFilters.length > 0) {
    addEvidence(
      evidence,
      seen,
      'gened',
      `GenEd ${genedFilters.join(', ')}`,
      'filter',
      'hard',
      course.gened ?? genedFilters.join(',')
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
    addEvidence(evidence, seen, 'difficulty', `${filters.difficulty} workload fit`, 'filter', 'soft', filters.difficulty);
    if (typeof course.quality_score === 'number') {
      addEvidence(evidence, seen, 'quality', `Quality ${course.quality_score.toFixed(0)}`, 'metadata', 'soft', course.quality_score.toFixed(0));
    }
  }

  if (softPreferences?.levelBoost) {
    addEvidence(evidence, seen, 'topic', `${softPreferences.levelBoost} level preference`, 'query', 'soft', String(softPreferences.levelBoost));
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
    addEvidence(evidence, seen, 'keyword', `Keyword rank #${result.keywordRank}`, 'keyword', 'rank', String(result.keywordRank));
  }
  if (result.semanticRank !== undefined) {
    addEvidence(evidence, seen, 'semantic', `Semantic rank #${result.semanticRank}`, 'semantic', 'rank', String(result.semanticRank));
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

export function searchResultToCourseDto(result: SearchResult, context?: SearchResultEvidenceContext): CourseDto {
  return toCourseDto(result.course, {
    score: result.score,
    semanticRank: result.semanticRank,
    keywordRank: result.keywordRank,
    historical: result.historical,
    matchEvidence: context ? buildMatchEvidence(result, context) : undefined,
    warnings: buildResultWarnings(result),
  });
}
