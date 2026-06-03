import type { ParsedSubjectCascade } from '../cisapi/parser.js';
import type { Course, Section, Subject, Meeting } from '../db/index.js';
import { makeCourseId, makeSectionId, makeTermId } from '../db/index.js';

export interface SectionWithDetails {
  section: Section;
  meetings: (Omit<Meeting, 'id'> & { instructors: { firstName: string; lastName: string }[] })[];
}

export interface CourseWithSections {
  course: Omit<Course, 'created_at' | 'updated_at'>;
  sections: SectionWithDetails[];
  genEdCategories: TransformedGenEdCategory[];
}

type TransformedGenEdCategory = {
  categoryId: string;
  categoryName: string;
  attributeCode: string | null;
  attributeName: string | null;
};

export interface TransformResult {
  subject: Subject;
  coursesWithSections: CourseWithSections[];
}

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
  term: string
): TransformResult {
  const now = Math.floor(Date.now() / 1000);
  const termId = makeTermId(year, term);

  const subject: Subject = {
    id: parsed.subjectId,
    name: parsed.subjectLabel,
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

  const coursesWithSections = parsed.courses.map(c => {
    const courseId = makeCourseId(parsed.subjectId, c.id, year, term);

    // Find all unique instructors for the course (prefer lectures)
    const allInstructors = new Set<string>();
    const lectureInstructors = new Set<string>();

    c.sections.forEach(s => {
      const isLecture = s.meetings.some(m => m.typeName.toLowerCase().includes('lecture') || m.typeCode === 'LEC');
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

    // Flatten GenEd categories
    const genEdCategories: TransformedGenEdCategory[] = c.genEdCategories.flatMap<TransformedGenEdCategory>(cat => {
      if (cat.attributes.length === 0) {
        return [{
          categoryId: cat.id,
          categoryName: cat.name,
          attributeCode: null,
          attributeName: null,
        }];
      }

      return cat.attributes.map(attr => ({
        categoryId: cat.id,
        categoryName: cat.name,
        attributeCode: attr.code,
        attributeName: attr.name,
      }));
    });

    return {
      course: {
        id: courseId,
        subject: parsed.subjectId,
        number: c.id,
        title: c.title,
        description: c.description || null,
        credit_hours: parseInt(c.creditHours) || null,
        gened: c.genEdCategories[0]?.id ?? null, // Keep for backward compat
        year,
        term,
        primary_instructor: formatInstructors(primaryInstructors),
        last_synced: now,
        avg_gpa: null,
        gpa_sample_size: null,
        primary_instructor_rmp: null,
        difficulty_score: null,
        quality_score: null,
        subject_id: parsed.subjectId,
        course_info: c.courseInfo || null,
        degree_attributes: c.degreeAttributes || null,
        class_schedule_info: c.classScheduleInfo || null,
        date_range_text: c.dateRangeText || null,
        registration_notes: c.registrationNotes || null,
        approval_code: c.approvalCode || null,
      },
      sections: c.sections.map(s => {
        // Use the first meeting for section-level summary fields.
        const firstMeeting = s.meetings[0];

        // Collect all instructors for this section
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
          type: firstMeeting?.typeName || null,
          days: firstMeeting?.days || null,
          start_time: firstMeeting?.startTime || null,
          end_time: firstMeeting?.endTime || null,
          location: firstMeeting ? `${firstMeeting.buildingName} ${firstMeeting.roomNumber}`.trim() || null : null,
          instructor: formatInstructors(Array.from(sectionInstructors)),

          instructor_rmp: null,
          instructor_gpa: null,
          last_synced: now,

          // New fields
          section_title: s.sectionTitle || null,
          status_code: s.statusCode || null,
          section_status_code: s.sectionStatusCode || null,
          section_text: s.sectionText || null,
          section_notes: s.sectionNotes || null,
          capp_area: s.cappArea || null,
          date_range_text: s.dateRangeText || null,
          part_of_term: s.partOfTerm || null,
          start_date: s.startDate || null,
          end_date: s.endDate || null,
          credit_hours: s.creditHours || null
        };

        const meetings = s.meetings.map(m => ({
          section_id: sectionId,
          meeting_index: m.index,
          type_code: m.typeCode || null,
          type_name: m.typeName || null,
          days: m.days || null,
          start_time: m.startTime || null,
          end_time: m.endTime || null,
          building_name: m.buildingName || null,
          room_number: m.roomNumber || null,
          date_range_text: m.dateRangeText || null,
          instructors: m.instructors
        }));

        return { section, meetings };
      }),
      genEdCategories
    };
  });

  return { subject, coursesWithSections };
}
