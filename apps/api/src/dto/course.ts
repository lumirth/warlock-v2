import type { Course, Meeting, Section } from '../db/types.js';
import type {
  CourseSectionMeetingDto,
  CourseDetailResponseDto,
  CourseExplorerUrlInput,
  CourseDto,
  CourseGenedDto,
  CourseSectionDto,
  InstructorLinkDto,
  MatchEvidence,
  ResultExplanation,
  ResultWarning,
  SectionMatchDto,
  SearchCourseResultDto,
} from '@uiuc-course-search/query-types';
import {
  buildCourseExplorerCourseUrl,
  buildCourseExplorerSectionUrl,
  buildRmpProfessorUrl,
  buildRmpSearchUrl,
} from '@uiuc-course-search/query-types';
import type { SearchResult } from '../services/search.js';
import {
  buildSearchResultPresentation,
  type SearchResultEvidenceContext,
} from '../services/search-result-presentation.js';
import { courseSnapshotRequirementEvidence } from '../transforms/course-requirements.js';
import { formatInstructorName, type CourseSnapshot } from '../transforms/course.js';

type CourseSource = Pick<
  Course,
  | 'id'
  | 'subject'
  | 'number'
  | 'title'
  | 'description'
  | 'credit_hours'
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
};

export type SearchCourseResultDtoOptions = CourseDtoOptions & {
  score?: number;
  semanticRank?: number;
  keywordRank?: number;
  historical?: boolean;
  matchEvidence?: MatchEvidence[];
  explanation?: ResultExplanation;
  warnings?: ResultWarning[];
  sectionMatches?: SectionMatchDto[];
};

export type CourseDetailResponseDtoOptions = CourseDtoOptions & {
  cached?: boolean;
  stale?: boolean;
  staleReason?: string | null;
  ageSeconds?: number;
  fetchedAt?: number;
  termStatus?: string;
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

export function toCourseDetailResponseDto(
  course: CourseSource,
  options: CourseDetailResponseDtoOptions = {},
): CourseDetailResponseDto {
  const dto = toCourseDto(course, options);
  const cache = {
    cached: options.cached,
    stale: options.stale,
    staleReason: options.staleReason,
    ageSeconds: options.ageSeconds,
    fetchedAt: options.fetchedAt,
    termStatus: options.termStatus,
  };

  return Object.values(cache).some((value) => value !== undefined)
    ? { ...dto, cache }
    : dto;
}

export function courseSnapshotToCourseDetailResponseDto(
  snapshot: CourseSnapshot,
  options: CourseDetailResponseDtoOptions = {},
): CourseDetailResponseDto {
  const dto = courseSnapshotToCourseDto(snapshot, options);
  const cache = {
    cached: options.cached,
    stale: options.stale,
    staleReason: options.staleReason,
    ageSeconds: options.ageSeconds,
    fetchedAt: options.fetchedAt,
    termStatus: options.termStatus,
  };

  return Object.values(cache).some((value) => value !== undefined)
    ? { ...dto, cache }
    : dto;
}

function snapshotGenedsToDto(snapshot: CourseSnapshot): CourseGenedDto[] {
  return courseSnapshotRequirementEvidence(snapshot).geneds;
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

export function searchResultToCourseDto(
  result: SearchResult,
  context?: SearchResultEvidenceContext,
): SearchCourseResultDto {
  const presentation = buildSearchResultPresentation(result, context);
  return {
    ...toCourseDto(result.course, {
      geneds: context?.requirementCodes,
    }),
    search: {
      score: result.score,
      semanticRank: result.semanticRank,
      keywordRank: result.keywordRank,
      historical: result.historical,
    },
    match_evidence: presentation.matchEvidence,
    explanation: presentation.explanation,
    warnings: presentation.warnings,
  };
}
