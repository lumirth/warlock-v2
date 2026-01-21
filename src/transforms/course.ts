import type { ParsedSubjectCascade, ParsedCascadeSection } from '../cisapi/parser.js';
import type { Course, Section } from '../db/index.js';
import { makeCourseId } from '../db/index.js';

export interface CourseWithSections {
  course: Omit<Course, 'created_at' | 'updated_at'>;
  sections: Section[];
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

export function fromSubjectCascade(
  parsed: ParsedSubjectCascade,
  year: number,
  term: string
): CourseWithSections[] {
  const now = Math.floor(Date.now() / 1000);

  return parsed.courses.map(c => {
    const courseId = makeCourseId(parsed.subjectId, c.id, year, term);

    // Find primary section (prefer lecture)
    const primarySection = c.sections.find(s =>
      s.type.toLowerCase().includes('lecture') || s.type.toLowerCase().includes('lec')
    ) ?? c.sections[0];

    return {
      course: {
        id: courseId,
        subject: parsed.subjectId,
        number: c.id,
        title: c.title,
        description: c.description || null,
        credit_hours: parseInt(c.creditHours) || null,
        gened: c.genEdCategories[0] ?? null,
        year,
        term,
        primary_instructor: formatInstructorName(primarySection?.instructors[0]),
        last_synced: now,
        avg_gpa: null,
        gpa_sample_size: null,
        primary_instructor_rmp: null,
        difficulty_score: null,
        quality_score: null,
        subject_id: null,
        course_info: null,
        degree_attributes: null,
        class_schedule_info: null,
        date_range_text: null,
        registration_notes: null,
        approval_code: null,
      },
      sections: c.sections.map(s => ({
        crn: s.crn,
        course_id: courseId,
        section_number: s.sectionNumber || null,
        status: s.enrollmentStatus || null,
        type: s.type || null,
        days: s.daysOfTheWeek || null,
        start_time: s.startTime || null,
        end_time: s.endTime || null,
        location: `${s.buildingName} ${s.roomNumber}`.trim() || null,
        instructor: formatInstructorName(s.instructors[0]),
        instructor_rmp: null,
        instructor_gpa: null,
        last_synced: now,
        section_title: null,
        status_code: null,
        section_status_code: null,
        section_text: null,
        section_notes: null,
        capp_area: null,
        date_range_text: null,
        part_of_term: null,
        start_date: null,
        end_date: null,
        credit_hours: null
      }))
    };
  });
}
