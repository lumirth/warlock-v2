import type { CourseExplorerCourse, ParsedSubjectCascade } from '../cisapi/parser.js';
import { makeCourseId, makeSectionId, makeTermId } from '../db/ids.js';
import type { Course, Meeting, Section, Subject } from '../db/types.js';

type Instructor = { firstName: string; lastName: string };
type SnapshotMeeting = Omit<Meeting, 'id'> & { instructors: Instructor[] };
export type CourseGenEdSnapshot = {
  categoryId: string; categoryName: string | null;
  attributeCode: string | null; attributeName: string | null;
};
export type CourseSnapshot = {
  course: Course;
  sections: { section: Section; meetings: SnapshotMeeting[] }[];
  genEdCategories: CourseGenEdSnapshot[];
};
export type SubjectSnapshot = {
  subject: Subject; courses: CourseSnapshot[]; termId: string;
  year: number; term: string; syncTimestamp: number;
};

export function formatInstructorName(instructor?: Instructor): string | null {
  const first = instructor?.firstName.trim();
  const last = instructor?.lastName.trim();
  return last ? (first ? `${last}, ${first}` : last) : null;
}

export function parseCourseCreditHours(
  value: string | null | undefined,
): { exact: number | null; text: string | null } {
  const text = value?.replace(/\s+/g, ' ').trim() || null;
  const match = text?.match(/^(\d+(?:\.\d+)?)\s*(?:(?:credit\s*)?(?:hours?|hrs?))?\.?$/i);
  const exact = match ? Number(match[1]) : NaN;
  return { exact: Number.isFinite(exact) && exact > 0 ? exact : null, text };
}

export function fromSubjectCascade(
  parsed: ParsedSubjectCascade,
  year: number,
  term: string,
  options: { syncTimestamp?: number } = {},
): SubjectSnapshot {
  const syncTimestamp = options.syncTimestamp ?? Math.floor(Date.now() / 1000);
  const termId = makeTermId(year, term);
  return {
    subject: {
      id: parsed.subjectId,
      name: parsed.subjectLabel || parsed.subjectId,
    },
    courses: parsed.courses.map(course => courseSnapshot(
      course, parsed.subjectId, year, term, termId, syncTimestamp,
    )),
    termId,
    year,
    term,
    syncTimestamp,
  };
}

function courseSnapshot(
  source: CourseExplorerCourse,
  subject: string,
  year: number,
  term: string,
  termId: string,
  syncedAt: number,
): CourseSnapshot {
  const number = source.id.trim().split(/\s+/).at(-1) ?? source.id;
  const id = makeCourseId(subject, number, year, term);
  const all = instructorNames(source.sections);
  const lectures = instructorNames(source.sections.filter(section =>
    section.meetings.some(meeting => meeting.typeCode === 'LEC'
      || meeting.type.toLowerCase().includes('lecture')),
  ));
  const credits = parseCourseCreditHours(source.creditHours);
  return {
    course: {
      id,
      subject,
      number,
      title: source.label,
      description: nullable(source.description),
      credit_hours: credits.exact,
      credit_hours_text: credits.text,
      year,
      term,
      primary_instructor: joined(lectures.length ? lectures : all),
      avg_gpa: null,
      gpa_sample_size: null,
      primary_instructor_rmp: null,
      difficulty_score: null,
      quality_score: null,
      subject_id: subject,
      course_info: nullable(source.courseSectionInformation),
      degree_attributes: nullable(source.sectionDegreeAttributes),
      class_schedule_info: nullable(source.classScheduleInformation),
      date_range_text: nullable(source.sectionDateRange),
      registration_notes: nullable(source.sectionRegistrationNotes),
      approval_code: nullable(source.sectionApprovalCode),
    },
    sections: source.sections.map(section => sectionSnapshot(section, id, termId, syncedAt)),
    genEdCategories: source.genEdCategories.flatMap(category =>
      (category.attributes.length ? category.attributes : [{ code: '', description: '' }])
        .map(attribute => ({
          categoryId: category.id,
          categoryName: nullable(category.description),
          attributeCode: nullable(attribute.code),
          attributeName: nullable(attribute.description),
        })),
    ),
  };
}

function sectionSnapshot(
  source: CourseExplorerCourse['sections'][number],
  courseId: string,
  termId: string,
  syncedAt: number,
): CourseSnapshot['sections'][number] {
  const first = source.meetings[0];
  const id = makeSectionId(termId, source.crn);
  return {
    section: {
      id,
      crn: source.crn,
      course_id: courseId,
      term_id: termId,
      section_number: nullable(source.sectionNumber),
      status: nullable(source.enrollmentStatus),
      type: nullable(first?.type),
      days: nullable(first?.daysOfTheWeek),
      start_time: nullable(first?.start),
      end_time: nullable(first?.end),
      location: first ? nullable(`${first.buildingName} ${first.roomNumber}`) : null,
      instructor: joined(instructorNames([source])),
      last_synced: syncedAt,
      section_title: nullable(source.sectionTitle),
      status_code: nullable(source.statusCode),
      section_status_code: nullable(source.sectionStatusCode),
      section_text: nullable(source.sectionText),
      section_notes: nullable(source.sectionNotes),
      capp_area: nullable(source.sectionCappArea),
      date_range_text: nullable(source.sectionDateRange),
      part_of_term: nullable(source.partOfTerm),
      start_date: nullable(source.startDate),
      end_date: nullable(source.endDate),
      credit_hours: nullable(source.creditHours),
    },
    meetings: source.meetings.map((meeting, meeting_index) => ({
      section_id: id,
      meeting_index,
      type_code: nullable(meeting.typeCode),
      type_name: nullable(meeting.type),
      days: nullable(meeting.daysOfTheWeek),
      start_time: nullable(meeting.start),
      end_time: nullable(meeting.end),
      building_name: nullable(meeting.buildingName),
      room_number: nullable(meeting.roomNumber),
      date_range_text: nullable(meeting.meetingDateRange),
      instructors: meeting.instructors,
    })),
  };
}

function instructorNames(sections: CourseExplorerCourse['sections']): string[] {
  return [...new Set(sections.flatMap(section => section.meetings)
    .flatMap(meeting => meeting.instructors)
    .map(formatInstructorName)
    .filter((name): name is string => Boolean(name)))];
}
function nullable(value: string | undefined): string | null {
  return value?.trim() || null;
}
function joined(values: string[]): string | null {
  return values.length ? values.join('; ') : null;
}
