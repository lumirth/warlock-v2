import type { D1Database } from '@cloudflare/workers-types';
import {
  buildCourseExplorerSectionUrl,
  buildRmpProfessorUrl,
  buildRmpSearchUrl,
  type CourseDetailResponseDto,
  type CourseInstructorDto,
  type CourseSectionDto,
} from '@warlock-v2/query-types';
import type { Course, CourseGened, InstructorLinkReadRow, Meeting, Section } from '../db/types.js';
import { makeCourseId } from '../db/ids.js';
import { toCourseDto } from '../dto/course.js';
import { courseRequirementRowsToDto } from '../transforms/course-requirements.js';
import { normalizeSectionAvailability } from './section-availability-policy.js';
import { resolveTermContext } from './term-state.js';

export type CourseDetailRequest = {
  subject: string; number: string;
  requestedYear?: string | null; requestedTerm?: string | null;
};
type MeetingDetail = Meeting & { instructor_names: string | null };
type SectionDetail = Section & { meetings: MeetingDetail[] };

export async function loadCourseDetail(
  db: D1Database,
  request: CourseDetailRequest,
): Promise<CourseDetailResponseDto | null> {
  const resolved = await resolveTermContext(db, {
    requestedYear: request.requestedYear,
    requestedTerm: request.requestedTerm,
  });
  const id = makeCourseId(request.subject, request.number, resolved.year, resolved.term);
  const course = await db.prepare('SELECT * FROM courses WHERE id = ?')
    .bind(id).first<Course>();
  if (!course) return null;

  const [instructorRows, sections, requirements] = await Promise.all([
    db.prepare(`
      SELECT l.instructor_name, r.rating AS rmp_rating, r.difficulty AS rmp_difficulty,
        r.rmp_id, r.num_ratings, r.would_take_again_pct,
        g.avg_gpa, g.sample_size AS gpa_sample_size
      FROM instructor_course_links l
      LEFT JOIN rmp_cache r ON l.rmp_id = r.rmp_id AND r.expires_at > unixepoch()
      LEFT JOIN gpa_stats g ON l.gpa_id = g.id
      WHERE l.term_id = ? AND l.subject = ? AND l.number = ?
    `).bind(resolved.termId, request.subject, request.number).all<InstructorLinkReadRow>(),
    loadSections(db, id),
    db.prepare(`
      SELECT category_id, category_name, attribute_code, attribute_name
      FROM course_gened WHERE course_id = ? ORDER BY category_id, attribute_code
    `).bind(id).all<CourseGened>(),
  ]);
  const instructors = instructorMap(instructorRows.results);
  return {
    course: {
      ...toCourseDto(course, {
        requirements: courseRequirementRowsToDto(requirements.results),
      }),
      sections: sections.map(section => sectionDto(section, instructors, course)),
    },
  };
}

async function loadSections(db: D1Database, courseId: string): Promise<SectionDetail[]> {
  const [sections, meetings] = await Promise.all([
    db.prepare('SELECT * FROM sections WHERE course_id = ? ORDER BY section_number, crn')
      .bind(courseId).all<Section>(),
    db.prepare(`
      SELECT m.*, GROUP_CONCAT(i.display_name, ';') AS instructor_names
      FROM meetings m JOIN sections s ON s.id = m.section_id
      LEFT JOIN meeting_instructors mi ON mi.meeting_id = m.id
      LEFT JOIN instructors i ON i.id = mi.instructor_id
      WHERE s.course_id = ? GROUP BY m.id ORDER BY m.section_id, m.meeting_index
    `).bind(courseId).all<MeetingDetail>(),
  ]);
  const grouped = new Map<string, MeetingDetail[]>();
  for (const meeting of meetings.results) {
    grouped.set(meeting.section_id, [...(grouped.get(meeting.section_id) ?? []), meeting]);
  }
  return sections.results.map(section => ({ ...section, meetings: grouped.get(section.id) ?? [] }));
}

function instructorMap(rows: InstructorLinkReadRow[]): Record<string, CourseInstructorDto> {
  return Object.fromEntries(rows.flatMap(row => {
    const name = row.instructor_name;
    if (!name) return [];
    const metric = (value: number | null | undefined) =>
      typeof value === 'number' && value > 0 && (row.num_ratings ?? 1) > 0 ? value : null;
    return [[name, {
      name,
      rmpRating: metric(row.rmp_rating),
      rmpDifficulty: metric(row.rmp_difficulty),
      rmpUrl: buildRmpProfessorUrl(row.rmp_id),
      rmpSearchUrl: buildRmpSearchUrl(name),
      avgGpa: row.avg_gpa ?? null,
      gpaSampleSize: row.gpa_sample_size ?? null,
      numRatings: row.num_ratings ?? null,
      wouldTakeAgainPct: row.would_take_again_pct ?? null,
    } satisfies CourseInstructorDto]];
  }));
}

function sectionDto(
  section: SectionDetail,
  instructors: Record<string, CourseInstructorDto>,
  course: Course,
): CourseSectionDto {
  return {
    crn: section.crn,
    sectionNumber: section.section_number ?? '?',
    availability: normalizeSectionAvailability({
      status: section.status,
      statusCode: section.status_code,
      sectionStatusCode: section.section_status_code,
    }),
    schedule: {
      type: section.type ?? '?',
      days: section.days,
      startTime: section.start_time,
      endTime: section.end_time,
      location: section.location ?? 'TBA',
      dateRangeText: section.date_range_text,
      partOfTerm: section.part_of_term,
      startDate: section.start_date,
      endDate: section.end_date,
      creditHours: section.credit_hours,
      meetings: section.meetings.map(meeting => ({
        typeCode: meeting.type_code,
        typeName: meeting.type_name,
        days: meeting.days,
        startTime: meeting.start_time,
        endTime: meeting.end_time,
        buildingName: meeting.building_name,
        roomNumber: meeting.room_number,
        dateRangeText: meeting.date_range_text,
        instructors: instructorsFor(meeting.instructor_names, instructors),
      })),
    },
    instructors: instructorsFor(section.instructor, instructors),
    sourceFacts: {
      sectionTitle: section.section_title,
      sectionText: section.section_text,
      sectionNotes: section.section_notes,
      cappArea: section.capp_area,
    },
    links: { courseExplorerUrl: buildCourseExplorerSectionUrl({ ...course, crn: section.crn }) },
  };
}

function instructorsFor(
  value: string | null,
  instructors: Record<string, CourseInstructorDto>,
): CourseInstructorDto[] {
  return [...new Set((value ?? '').split(';').map(name => name.trim()).filter(name =>
    name && !/^(tba|arranged|staff|n\/?a)$/i.test(name),
  ))].map(name => instructors[name] ?? {
    name, rmpRating: null, rmpDifficulty: null, rmpUrl: null,
    rmpSearchUrl: buildRmpSearchUrl(name), avgGpa: null,
    gpaSampleSize: null, numRatings: null, wouldTakeAgainPct: null,
  });
}
