import {
  buildCourseExplorerCourseUrl,
  type CourseRegistrationSummaryDto,
  type CourseRequirementDto,
  type CourseSummaryDto,
} from '@warlock-v2/query-types';
import type { Course } from '../db/types.js';

type Options = {
  requirements?: CourseRequirementDto[];
  registrationSummary?: CourseRegistrationSummaryDto;
};

export function toCourseDto(
  course: Course,
  options: Options = {},
): CourseSummaryDto {
  const rating = course.primary_instructor_rmp;
  return {
    id: course.id,
    subject: course.subject,
    number: course.number,
    title: course.title,
    description: course.description,
    creditHours: course.credit_hours,
    creditHoursText: course.credit_hours_text,
    year: course.year,
    term: course.term,
    primaryInstructor: course.primary_instructor,
    metrics: {
      primaryInstructorRating: rating && rating > 0 ? rating : null,
      avgGpa: course.avg_gpa,
      gpaSampleSize: course.gpa_sample_size,
      qualityScore: course.quality_score,
      instructorDifficultyScore: course.difficulty_score,
    },
    catalog: {
      courseInfo: course.course_info,
      degreeAttributes: course.degree_attributes,
    },
    scheduleNotes: {
      classScheduleInfo: course.class_schedule_info,
      dateRangeText: course.date_range_text,
    },
    registration: {
      registrationNotes: course.registration_notes,
      approvalCode: course.approval_code,
    },
    ...(options.registrationSummary ? { registrationSummary: options.registrationSummary } : {}),
    requirements: options.requirements ?? [],
    links: { courseExplorerUrl: buildCourseExplorerCourseUrl(course) },
  };
}
