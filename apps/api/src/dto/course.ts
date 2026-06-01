import type { Course, Section } from '../db/index.js';
import type { CourseDto, CourseSectionDto, InstructorLinkDto } from '@uiuc-course-search/query-types';
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
  | 'primary_instructor'
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
  };
}

export function searchResultToCourseDto(result: SearchResult): CourseDto {
  return toCourseDto(result.course, {
    score: result.score,
    semanticRank: result.semanticRank,
    keywordRank: result.keywordRank,
    historical: result.historical,
  });
}
