import type { CISAPICourseDetail } from '../cisapi/types.js';
import type { ParsedCascadeCourse, ParsedSubjectCascade } from '../cisapi/parser.js';
import { makeCourseId, makeSectionId, makeTermId } from '../db/ids.js';
import type { Course, Section, Subject, Meeting } from '../db/types.js';

export type SnapshotInstructor = { firstName: string; lastName: string };

export interface SectionSnapshot {
  section: Section;
  meetings: (Omit<Meeting, 'id'> & { instructors: SnapshotInstructor[] })[];
}

export interface CourseSnapshot {
  course: Omit<Course, 'created_at' | 'updated_at'>;
  sections: SectionSnapshot[];
  genEdCategories: CourseGenEdSnapshot[];
}

export type CourseGenEdSnapshot = {
  categoryId: string;
  categoryName: string | null;
  attributeCode: string | null;
  attributeName: string | null;
};

export interface SubjectSnapshot {
  subject: Subject;
  courses: CourseSnapshot[];
  termId: string;
  year: number;
  term: string;
  syncTimestamp: number;
}

export type SectionWithDetails = SectionSnapshot;
export type CourseWithSections = CourseSnapshot;
export type TransformedGenEdCategory = CourseGenEdSnapshot;
export type TransformResult = SubjectSnapshot;

type TransformOptions = {
  syncTimestamp?: number;
};

export function formatInstructorName(
  instructor: { firstName: string; lastName: string } | undefined
): string | null {
  if (!instructor) return null;
  const first = instructor.firstName?.charAt(0);
  return first
    ? `${instructor.lastName}, ${first}`
    : instructor.lastName;
}

export function formatInstructors(instructors: string[]): string | null {
  if (instructors.length === 0) return null;
  return instructors.join('; ');
}

export function fromSubjectCascade(
  parsed: ParsedSubjectCascade,
  year: number,
  term: string,
  options: TransformOptions = {}
): SubjectSnapshot {
  const now = options.syncTimestamp ?? Math.floor(Date.now() / 1000);
  const termId = makeTermId(year, term);

  const subject: Subject = {
    id: parsed.subjectId,
    name: parsed.subjectLabel || parsed.subjectMetadata?.label || parsed.subjectId,
    college_code: parsed.subjectMetadata?.collegeCode || null,
    department_code: parsed.subjectMetadata?.departmentCode || null,
    unit_name: parsed.subjectMetadata?.unitName || null,
    contact_name: parsed.subjectMetadata?.contactName || null,
    contact_title: parsed.subjectMetadata?.contactTitle || null,
    address_line1: parsed.subjectMetadata?.addressLine1 || null,
    address_line2: parsed.subjectMetadata?.addressLine2 || null,
    phone_number: parsed.subjectMetadata?.phoneNumber || null,
    website_url: parsed.subjectMetadata?.websiteUrl || null,
    description: parsed.subjectMetadata?.description || null,
    last_synced: now,
  };

  return {
    subject,
    courses: parsed.courses.map(course => transformCascadeCourseToSnapshot({
      course,
      subjectId: parsed.subjectId,
      year,
      term,
      termId,
      syncTimestamp: now,
    })),
    termId,
    year,
    term,
    syncTimestamp: now,
  };
}

export function fromCourseDetail(
  parsed: CISAPICourseDetail,
  subject: string,
  number: string,
  year: number,
  term: string,
  options: TransformOptions = {}
): CourseSnapshot {
  const termId = makeTermId(year, term);
  const syncTimestamp = options.syncTimestamp ?? Math.floor(Date.now() / 1000);

  return transformCascadeCourseToSnapshot({
    course: courseDetailToCascadeCourse(parsed, subject, number),
    subjectId: subject,
    year,
    term,
    termId,
    syncTimestamp,
  });
}

function transformCascadeCourseToSnapshot({
  course,
  subjectId,
  year,
  term,
  termId,
  syncTimestamp,
}: {
  course: ParsedCascadeCourse;
  subjectId: string;
  year: number;
  term: string;
  termId: string;
  syncTimestamp: number;
}): CourseSnapshot {
  const courseId = makeCourseId(subjectId, course.id, year, term);

  const allInstructors = new Set<string>();
  const lectureInstructors = new Set<string>();

  course.sections.forEach(s => {
    const isLecture = s.meetings.some(m => (
      m.type.toLowerCase().includes('lecture') || m.typeCode === 'LEC'
    ));
    s.meetings.forEach(m => {
      m.instructors.forEach(inst => {
        const name = formatInstructorName(inst);
        if (name) {
          allInstructors.add(name);
          if (isLecture) lectureInstructors.add(name);
        }
      });
    });
  });

  const primaryInstructors = lectureInstructors.size > 0
    ? Array.from(lectureInstructors)
    : Array.from(allInstructors);

  const genEdCategories = flattenGenEdCategories(course);

  return {
    course: {
      id: courseId,
      subject: subjectId,
      number: course.id,
      title: course.title,
      description: course.description || null,
      credit_hours: parseInt(course.creditHours, 10) || null,
      year,
      term,
      primary_instructor: formatInstructors(primaryInstructors),
      last_synced: syncTimestamp,
      avg_gpa: null,
      gpa_sample_size: null,
      primary_instructor_rmp: null,
      difficulty_score: null,
      quality_score: null,
      subject_id: subjectId,
      course_info: course.courseSectionInformation || null,
      degree_attributes: course.sectionDegreeAttributes || null,
      class_schedule_info: course.classScheduleInformation || null,
      date_range_text: course.sectionDateRange || null,
      registration_notes: course.sectionRegistrationNotes || null,
      approval_code: course.sectionApprovalCode || null,
    },
    sections: course.sections.map(s => {
      const firstMeeting = s.meetings[0];

      const sectionInstructors = new Set<string>();
      s.meetings.forEach(m => {
        m.instructors.forEach(inst => {
          const name = formatInstructorName(inst);
          if (name) sectionInstructors.add(name);
        });
      });

      const sectionId = makeSectionId(termId, s.crn);
      const section: Section = {
        id: sectionId,
        crn: s.crn,
        course_id: courseId,
        term_id: termId,
        section_number: s.sectionNumber || null,
        status: s.enrollmentStatus || null,
        type: firstMeeting?.type || null,
        days: firstMeeting?.daysOfTheWeek || null,
        start_time: firstMeeting?.start || null,
        end_time: firstMeeting?.end || null,
        location: firstMeeting ? `${firstMeeting.buildingName} ${firstMeeting.roomNumber}`.trim() || null : null,
        instructor: formatInstructors(Array.from(sectionInstructors)),

        instructor_rmp: null,
        instructor_gpa: null,
        last_synced: syncTimestamp,

        section_title: s.sectionTitle || null,
        status_code: s.statusCode || null,
        section_status_code: s.sectionStatusCode || null,
        section_text: s.sectionText || null,
        section_notes: s.sectionNotes || null,
        capp_area: s.sectionCappArea || null,
        date_range_text: s.sectionDateRange || null,
        part_of_term: s.partOfTerm || null,
        start_date: s.startDate || null,
        end_date: s.endDate || null,
        credit_hours: s.creditHours || null,
      };

      const meetings = s.meetings.map(m => ({
        section_id: sectionId,
        meeting_index: m.index,
        type_code: m.typeCode || null,
        type_name: m.type || null,
        days: m.daysOfTheWeek || null,
        start_time: m.start || null,
        end_time: m.end || null,
        building_name: m.buildingName || null,
        room_number: m.roomNumber || null,
        date_range_text: m.meetingDateRange || null,
        instructors: m.instructors,
      }));

      return { section, meetings };
    }),
    genEdCategories,
  };
}

function flattenGenEdCategories(course: Pick<ParsedCascadeCourse, 'genEdCategories'>): CourseGenEdSnapshot[] {
  return course.genEdCategories.flatMap<CourseGenEdSnapshot>(cat => {
    if (cat.attributes.length === 0) {
      return [{
        categoryId: cat.id,
        categoryName: cat.name || null,
        attributeCode: null,
        attributeName: null,
      }];
    }

    return cat.attributes.map(attr => ({
      categoryId: cat.id,
      categoryName: cat.name || null,
      attributeCode: attr.code || null,
      attributeName: attr.name || null,
    }));
  });
}

function courseDetailToCascadeCourse(
  parsed: CISAPICourseDetail,
  subject: string,
  number: string
): ParsedCascadeCourse {
  return {
    id: number,
    subject,
    title: parsed.label,
    description: parsed.description,
    creditHours: parsed.creditHours,
    courseSectionInformation: parsed.courseSectionInformation,
    sectionDegreeAttributes: parsed.sectionDegreeAttributes,
    classScheduleInformation: parsed.classScheduleInformation,
    sectionDateRange: parsed.sectionDateRange,
    sectionRegistrationNotes: parsed.sectionRegistrationNotes,
    sectionApprovalCode: parsed.sectionApprovalCode,
    genEdCategories: parsed.genEdCategories.map(category => ({
      id: category.id,
      name: category.description,
      attributes: category.attributes.map(attribute => ({
        code: attribute.code,
        name: attribute.description,
      })),
    })),
    sections: parsed.sections.map(section => ({
      crn: section.crn,
      sectionNumber: section.sectionNumber,
      sectionTitle: section.sectionTitle,
      enrollmentStatus: section.enrollmentStatus,
      statusCode: section.statusCode,
      sectionStatusCode: section.sectionStatusCode,
      sectionText: section.sectionText,
      sectionNotes: section.sectionNotes,
      sectionCappArea: section.sectionCappArea,
      sectionDateRange: section.sectionDateRange,
      partOfTerm: section.partOfTerm,
      startDate: section.startDate,
      endDate: section.endDate,
      creditHours: section.creditHours,
      meetings: section.meetings.map((meeting, index) => ({
        index,
        typeCode: meeting.typeCode,
        type: meeting.type,
        start: meeting.start,
        end: meeting.end,
        daysOfTheWeek: meeting.daysOfTheWeek,
        buildingName: meeting.buildingName,
        roomNumber: meeting.roomNumber,
        meetingDateRange: meeting.meetingDateRange,
        instructors: meeting.instructors,
      })),
    })),
  };
}
