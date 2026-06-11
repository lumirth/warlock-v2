import type {
  Course,
  InstructorLinkReadRow,
  Meeting,
  Section,
} from '../db/types.js';
import type {
  CourseDetailCacheDto,
  CourseSectionMeetingDto,
  CourseDetailResponseDto,
  CourseDetailDto,
  CourseExplorerUrlInput,
  CourseInstructorDto,
  CourseRequirementDto,
  CourseSectionDto,
  CourseSummaryDto,
} from '@uiuc-course-search/query-types';
import {
  buildCourseExplorerCourseUrl,
  buildCourseExplorerSectionUrl,
  buildRmpProfessorUrl,
  buildRmpSearchUrl,
} from '@uiuc-course-search/query-types';
import { normalizeSectionAvailability } from '../services/section-availability-policy.js';
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

type CourseSectionReadModel = Section & {
  meetings?: CourseSectionMeetingReadModel[];
};

type CourseSummaryDtoOptions = {
  requirements?: CourseRequirementDto[];
  medianGpa?: number | null;
};

type CourseDetailDtoOptions = CourseSummaryDtoOptions & {
  sections?: CourseSectionDto[];
  instructorMap?: Record<string, CourseInstructorDto>;
};

type CourseSectionMeetingReadModel = Omit<Meeting, 'id'> & {
  id?: Meeting['id'];
  instructor_names?: string | null;
};

function validRmpMetric(value: number | null | undefined, numRatings?: number | null): number | null {
  if (typeof value !== 'number' || value <= 0) return null;
  if (typeof numRatings === 'number' && numRatings <= 0) return null;
  return value;
}

export function toCourseInstructorDto(
  row: InstructorLinkReadRow | null | undefined,
): CourseInstructorDto | null {
  const instructorName = row?.instructor_name ?? null;
  if (!instructorName) return null;

  return {
    name: instructorName,
    rmpRating: validRmpMetric(row?.rmp_rating, row?.num_ratings),
    rmpDifficulty: validRmpMetric(row?.rmp_difficulty, row?.num_ratings),
    rmpId: row?.rmp_id ?? null,
    rmpUrl: buildRmpProfessorUrl(row?.rmp_id),
    rmpSearchUrl: buildRmpSearchUrl(instructorName),
    avgGpa: row?.avg_gpa ?? null,
    medianGpa: row?.median_gpa ?? null,
    gpaSampleSize: row?.gpa_sample_size ?? null,
    numRatings: row?.num_ratings ?? null,
    wouldTakeAgainPct: row?.would_take_again_pct ?? null,
    topTags: normalizeTopTags(row?.top_tags),
    department: row?.department ?? null,
  };
}

export function toCourseInstructorMap(rows: InstructorLinkReadRow[]): Record<string, CourseInstructorDto> {
  return Object.fromEntries(
    rows
      .map(toCourseInstructorDto)
      .filter((instructor): instructor is CourseInstructorDto => instructor !== null)
      .map(instructor => [instructor.name, instructor])
  );
}

export function toCourseSectionDtos(
  sections: CourseSectionReadModel[],
  instructorMap: Record<string, CourseInstructorDto>,
): CourseSectionDto[] {
  return sections.map((section) => ({
    crn: section.crn,
    sectionNumber: section.section_number ?? '?',
    availability: normalizeSectionAvailability({
      status: section.status,
      statusCode: section.status_code,
      sectionStatusCode: section.section_status_code,
    }),
    schedule: {
      type: section.type ?? '?',
      days: section.days ?? null,
      startTime: section.start_time ?? null,
      endTime: section.end_time ?? null,
      location: section.location ?? 'TBA',
      dateRangeText: section.date_range_text ?? null,
      partOfTerm: section.part_of_term ?? null,
      startDate: section.start_date ?? null,
      endDate: section.end_date ?? null,
      creditHours: section.credit_hours ?? null,
      meetings: (section.meetings ?? [])
        .map(meeting => toCourseSectionMeetingDto(meeting, instructorMap)),
    },
    instructors: instructorsForNames(section.instructor, instructorMap),
    sourceFacts: {
      sectionTitle: section.section_title ?? null,
      sectionText: section.section_text ?? null,
      sectionNotes: section.section_notes ?? null,
      cappArea: section.capp_area ?? null,
    },
    links: {
      courseExplorerUrl: buildSectionCourseExplorerUrl(section),
    },
  }));
}

function toCourseSectionMeetingDto(
  meeting: CourseSectionMeetingReadModel,
  instructorMap: Record<string, CourseInstructorDto>,
): CourseSectionMeetingDto {
  return {
    typeCode: meeting.type_code ?? null,
    typeName: meeting.type_name ?? null,
    days: meeting.days ?? null,
    startTime: meeting.start_time ?? null,
    endTime: meeting.end_time ?? null,
    buildingName: meeting.building_name ?? null,
    roomNumber: meeting.room_number ?? null,
    dateRangeText: meeting.date_range_text ?? null,
    instructors: instructorsForNames(meeting.instructor_names, instructorMap),
  };
}

export function toCourseDto(
  course: CourseSource,
  options: CourseSummaryDtoOptions = {},
): CourseSummaryDto {
  return {
    id: course.id,
    subject: course.subject,
    number: course.number,
    title: course.title,
    description: course.description ?? null,
    creditHours: course.credit_hours ?? null,
    year: course.year,
    term: course.term,
    primaryInstructor: course.primary_instructor ?? null,
    metrics: {
      primaryInstructorRating: validRmpMetric(course.primary_instructor_rmp),
      avgGpa: course.avg_gpa ?? null,
      medianGpa: options.medianGpa ?? course.median_gpa ?? null,
      gpaSampleSize: course.gpa_sample_size ?? null,
      qualityScore: course.quality_score ?? null,
      workloadScore: course.difficulty_score ?? null,
    },
    catalog: {
      courseInfo: course.course_info ?? null,
      degreeAttributes: course.degree_attributes ?? null,
    },
    scheduleNotes: {
      classScheduleInfo: course.class_schedule_info ?? null,
      dateRangeText: course.date_range_text ?? null,
    },
    registration: {
      registrationNotes: course.registration_notes ?? null,
      approvalCode: course.approval_code ?? null,
    },
    requirements: options.requirements ?? [],
    links: {
      courseExplorerUrl: buildCourseExplorerCourseUrl(course),
    },
  };
}

function courseSnapshotToCourseDto(
  snapshot: CourseSnapshot,
  options: CourseDetailDtoOptions = {}
): CourseDetailDto {
  const {
    sections: providedSections,
    requirements: providedRequirements,
    instructorMap = {},
    ...courseOptions
  } = options;

  const summary = toCourseDto(snapshot.course, {
    ...courseOptions,
    requirements: providedRequirements ?? snapshotRequirementsToDto(snapshot),
  });

  return {
    ...summary,
    sections: providedSections ?? snapshotSectionsToDto(snapshot, instructorMap),
  };
}

export function toCourseDetailResponseDto(
  course: CourseSource,
  options: CourseDetailDtoOptions = {},
  cache?: CourseDetailCacheDto,
): CourseDetailResponseDto {
  const courseDto: CourseDetailDto = {
    ...toCourseDto(course, options),
    sections: options.sections ?? [],
  };
  return courseDetailResponse(courseDto, cache);
}

export function courseSnapshotToCourseDetailResponseDto(
  snapshot: CourseSnapshot,
  options: CourseDetailDtoOptions = {},
  cache?: CourseDetailCacheDto,
): CourseDetailResponseDto {
  return courseDetailResponse(courseSnapshotToCourseDto(snapshot, options), cache);
}

function courseDetailResponse(
  course: CourseDetailDto,
  cache?: CourseDetailCacheDto,
): CourseDetailResponseDto {
  return cache && Object.values(cache).some((value) => value !== undefined)
    ? { course, cache }
    : { course };
}

function snapshotRequirementsToDto(snapshot: CourseSnapshot): CourseRequirementDto[] {
  return courseSnapshotRequirementEvidence(snapshot).requirements;
}

function snapshotSectionsToDto(
  snapshot: CourseSnapshot,
  instructorMap: Record<string, CourseInstructorDto>
): CourseSectionDto[] {
  return toCourseSectionDtos(
    snapshot.sections.map(({ section, meetings }) => ({
      ...section,
      meetings: meetings.map(meeting => {
        const instructorNames = meeting.instructors
          .map(formatInstructorName)
          .filter((name): name is string => Boolean(name));

        return {
          ...meeting,
          instructor_names: instructorNames.join(';'),
        };
      }),
    })),
    instructorMap,
  );
}

function instructorsForNames(
  instructorNames: string | null | undefined,
  instructorMap: Record<string, CourseInstructorDto>,
): CourseInstructorDto[] {
  const names = instructorNames?.split(';') ?? [];
  return [
    ...new Set(names.map(name => name.trim()).filter(isNamedInstructor)),
  ]
    .map(name => instructorMap[name] ?? emptyCourseInstructor(name));
}

function emptyCourseInstructor(name: string): CourseInstructorDto {
  return {
    name,
    rmpRating: null,
    rmpDifficulty: null,
    rmpId: null,
    rmpUrl: null,
    rmpSearchUrl: buildRmpSearchUrl(name),
    avgGpa: null,
    medianGpa: null,
    gpaSampleSize: null,
    numRatings: null,
    wouldTakeAgainPct: null,
    topTags: null,
    department: null,
  };
}

function isNamedInstructor(name: string): boolean {
  return Boolean(name) && !/^(?:tba|arranged|staff|n\/?a)$/i.test(name);
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

function buildSectionCourseExplorerUrl(section: Section): string | undefined {
  const courseParts = parseCourseId(section.course_id);
  if (!courseParts) {
    return undefined;
  }

  return buildCourseExplorerSectionUrl({
    ...courseParts,
    crn: section.crn,
  });
}
