import type { D1Database } from '@cloudflare/workers-types';
import { normalizeInstructorFirstName } from '../db/instructor-name.js';
import type { CourseGened, Instructor } from '../db/types.js';
import type {
  CourseSnapshot,
  SubjectSnapshot,
} from '../transforms/course.js';
import type {
  SnapshotPersistenceOperation,
  SubjectSnapshotManifest,
} from './snapshot-persistence-operations.js';

type SnapshotSqlParam = string | number | null;

type SnapshotSqlStatement = {
  sql: string;
  params: SnapshotSqlParam[];
};

export function prepareSnapshotOperation(
  db: D1Database,
  operation: SnapshotPersistenceOperation
): D1PreparedStatement {
  const statement = snapshotOperationStatement(operation);
  return db.prepare(statement.sql).bind(...statement.params);
}

export function snapshotOperationStatement(
  operation: SnapshotPersistenceOperation
): SnapshotSqlStatement {
  switch (operation.kind) {
    case 'subject.upsert':
      return subjectUpsertStatement(operation.subject);
    case 'course.upsert':
      return courseUpsertStatement(operation.course);
    case 'course_gened.upsert':
      return courseGenedUpsertStatement(operation.gened);
    case 'section.upsert':
      return sectionUpsertStatement(operation.section);
    case 'instructor.upsert':
      return instructorUpsertStatement(operation.instructor);
    case 'meeting.upsert':
      return meetingUpsertStatement(operation.meeting);
    case 'meeting_instructor.link':
      return {
        sql: 'INSERT INTO meeting_instructors (meeting_id, instructor_id) SELECT m.id, i.id FROM meetings m, instructors i WHERE m.section_id = ? AND m.meeting_index = ? AND i.last_name = ? AND i.first_name = ? ON CONFLICT(meeting_id, instructor_id) DO NOTHING',
        params: [
          operation.sectionId,
          operation.meetingIndex,
          operation.lastName,
          normalizeInstructorFirstName(operation.firstName),
        ],
      };
    case 'subject.prune_stale_meeting_instructors':
      return staleMeetingInstructorStatement(operation.manifest);
    case 'subject.prune_stale_meetings':
      return staleMeetingStatement(operation.manifest);
    case 'subject.prune_stale_sections':
      return staleSectionStatement(operation.manifest);
    case 'subject.prune_stale_course_geneds':
      return staleCourseGenEdStatement(operation.manifest);
    case 'subject.prune_stale_courses':
      return staleCourseStatement(operation.manifest);
  }
}

function subjectUpsertStatement(subject: SubjectSnapshot['subject']): SnapshotSqlStatement {
  return {
    sql: 'INSERT INTO subjects (id, name, college_code, department_code, unit_name, contact_name, contact_title, address_line1, address_line2, phone_number, website_url, description, last_synced) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, college_code = excluded.college_code, department_code = excluded.department_code, unit_name = excluded.unit_name, contact_name = excluded.contact_name, contact_title = excluded.contact_title, address_line1 = excluded.address_line1, address_line2 = excluded.address_line2, phone_number = excluded.phone_number, website_url = excluded.website_url, description = excluded.description, last_synced = excluded.last_synced',
    params: [
      subject.id,
      subject.name,
      subject.college_code,
      subject.department_code,
      subject.unit_name,
      subject.contact_name,
      subject.contact_title,
      subject.address_line1,
      subject.address_line2,
      subject.phone_number,
      subject.website_url,
      subject.description,
      subject.last_synced,
    ],
  };
}

function courseUpsertStatement(course: CourseSnapshot['course']): SnapshotSqlStatement {
  return {
    sql: 'INSERT INTO courses (id, subject, number, title, description, credit_hours, credit_hours_text, subject_id, course_info, degree_attributes, class_schedule_info, date_range_text, registration_notes, approval_code, year, term, avg_gpa, gpa_sample_size, primary_instructor, primary_instructor_rmp, difficulty_score, quality_score, last_synced) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, description = excluded.description, credit_hours = excluded.credit_hours, credit_hours_text = excluded.credit_hours_text, subject_id = excluded.subject_id, course_info = excluded.course_info, degree_attributes = excluded.degree_attributes, class_schedule_info = excluded.class_schedule_info, date_range_text = excluded.date_range_text, registration_notes = excluded.registration_notes, approval_code = excluded.approval_code, primary_instructor = excluded.primary_instructor, last_synced = excluded.last_synced, updated_at = unixepoch()',
    params: [
      course.id,
      course.subject,
      course.number,
      course.title,
      course.description,
      course.credit_hours,
      course.credit_hours_text,
      course.subject_id,
      course.course_info,
      course.degree_attributes,
      course.class_schedule_info,
      course.date_range_text,
      course.registration_notes,
      course.approval_code,
      course.year,
      course.term,
      course.avg_gpa,
      course.gpa_sample_size,
      course.primary_instructor,
      course.primary_instructor_rmp,
      course.difficulty_score,
      course.quality_score,
      course.last_synced,
    ],
  };
}

function courseGenedUpsertStatement(gened: Omit<CourseGened, 'id'>): SnapshotSqlStatement {
  return {
    sql: 'INSERT INTO course_gened (course_id, category_id, category_name, attribute_code, attribute_name) VALUES (?, ?, ?, ?, ?) ON CONFLICT(course_id, category_id, attribute_code) DO UPDATE SET category_name = excluded.category_name, attribute_name = excluded.attribute_name',
    params: [
      gened.course_id,
      gened.category_id,
      gened.category_name,
      gened.attribute_code,
      gened.attribute_name,
    ],
  };
}

function sectionUpsertStatement(section: CourseSnapshot['sections'][number]['section']): SnapshotSqlStatement {
  return {
    sql: 'INSERT INTO sections (id, crn, course_id, term_id, section_number, status, type, days, start_time, end_time, location, instructor, instructor_rmp, instructor_gpa, last_synced, section_title, status_code, section_status_code, section_text, section_notes, capp_area, date_range_text, part_of_term, start_date, end_date, credit_hours) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET crn = excluded.crn, course_id = excluded.course_id, term_id = excluded.term_id, section_number = excluded.section_number, status = excluded.status, type = excluded.type, days = excluded.days, start_time = excluded.start_time, end_time = excluded.end_time, location = excluded.location, instructor = excluded.instructor, instructor_rmp = excluded.instructor_rmp, instructor_gpa = excluded.instructor_gpa, last_synced = excluded.last_synced, section_title = excluded.section_title, status_code = excluded.status_code, section_status_code = excluded.section_status_code, section_text = excluded.section_text, section_notes = excluded.section_notes, capp_area = excluded.capp_area, date_range_text = excluded.date_range_text, part_of_term = excluded.part_of_term, start_date = excluded.start_date, end_date = excluded.end_date, credit_hours = excluded.credit_hours',
    params: [
      section.id,
      section.crn,
      section.course_id,
      section.term_id,
      section.section_number,
      section.status,
      section.type,
      section.days,
      section.start_time,
      section.end_time,
      section.location,
      section.instructor,
      section.instructor_rmp,
      section.instructor_gpa,
      section.last_synced,
      section.section_title,
      section.status_code,
      section.section_status_code,
      section.section_text,
      section.section_notes,
      section.capp_area,
      section.date_range_text,
      section.part_of_term,
      section.start_date,
      section.end_date,
      section.credit_hours,
    ],
  };
}

function instructorUpsertStatement(instructor: Omit<Instructor, 'id'>): SnapshotSqlStatement {
  return {
    sql: 'INSERT INTO instructors (first_name, last_name, display_name, rmp_rating, rmp_difficulty, avg_gpa, gpa_sample_size) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(last_name, first_name) DO UPDATE SET display_name = excluded.display_name, rmp_rating = excluded.rmp_rating, rmp_difficulty = excluded.rmp_difficulty, avg_gpa = excluded.avg_gpa, gpa_sample_size = excluded.gpa_sample_size',
    params: [
      normalizeInstructorFirstName(instructor.first_name),
      instructor.last_name,
      instructor.display_name,
      instructor.rmp_rating,
      instructor.rmp_difficulty,
      instructor.avg_gpa,
      instructor.gpa_sample_size,
    ],
  };
}

function meetingUpsertStatement(
  meeting: Omit<CourseSnapshot['sections'][number]['meetings'][number], 'instructors'>
): SnapshotSqlStatement {
  return {
    sql: 'INSERT INTO meetings (section_id, meeting_index, type_code, type_name, days, start_time, end_time, building_name, room_number, date_range_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(section_id, meeting_index) DO UPDATE SET type_code = excluded.type_code, type_name = excluded.type_name, days = excluded.days, start_time = excluded.start_time, end_time = excluded.end_time, building_name = excluded.building_name, room_number = excluded.room_number, date_range_text = excluded.date_range_text',
    params: [
      meeting.section_id,
      meeting.meeting_index,
      meeting.type_code,
      meeting.type_name,
      meeting.days,
      meeting.start_time,
      meeting.end_time,
      meeting.building_name,
      meeting.room_number,
      meeting.date_range_text,
    ],
  };
}

function subjectScopeParams(
  manifest: SubjectSnapshotManifest
): SnapshotSqlParam[] {
  return [
    manifest.subjectId,
    manifest.year,
    manifest.term,
  ];
}

function staleMeetingInstructorStatement(
  manifest: SubjectSnapshotManifest
): SnapshotSqlStatement {
  return {
    sql: `
      DELETE FROM meeting_instructors
      WHERE meeting_id IN (
        SELECT m.id
        FROM meetings m
        JOIN sections s ON s.id = m.section_id
        JOIN courses c ON c.id = s.course_id
        WHERE c.subject = ? AND c.year = ? AND c.term = ?
      )
      AND NOT EXISTS (
        SELECT 1
        FROM meetings current_meeting
        JOIN instructors current_instructor
          ON current_instructor.id = meeting_instructors.instructor_id,
          json_each(?) current_link
        WHERE current_meeting.id = meeting_instructors.meeting_id
          AND json_extract(current_link.value, '$.sectionId') = current_meeting.section_id
          AND CAST(json_extract(current_link.value, '$.meetingIndex') AS INTEGER)
            = current_meeting.meeting_index
          AND json_extract(current_link.value, '$.lastName') = current_instructor.last_name
          AND json_extract(current_link.value, '$.firstName') = current_instructor.first_name
      )
    `,
    params: [
      ...subjectScopeParams(manifest),
      manifest.meetingInstructorKeysJson,
    ],
  };
}

function staleMeetingStatement(
  manifest: SubjectSnapshotManifest
): SnapshotSqlStatement {
  return {
    sql: `
      DELETE FROM meetings
      WHERE section_id IN (
        SELECT s.id
        FROM sections s
        JOIN courses c ON c.id = s.course_id
        WHERE c.subject = ? AND c.year = ? AND c.term = ?
      )
      AND NOT EXISTS (
        SELECT 1
        FROM json_each(?) current_meeting
        WHERE json_extract(current_meeting.value, '$.sectionId') = meetings.section_id
          AND CAST(json_extract(current_meeting.value, '$.meetingIndex') AS INTEGER)
            = meetings.meeting_index
      )
    `,
    params: [
      ...subjectScopeParams(manifest),
      manifest.meetingKeysJson,
    ],
  };
}

function staleSectionStatement(
  manifest: SubjectSnapshotManifest
): SnapshotSqlStatement {
  return {
    sql: `
      DELETE FROM sections
      WHERE course_id IN (
        SELECT id FROM courses
        WHERE subject = ? AND year = ? AND term = ?
      )
      AND id NOT IN (SELECT value FROM json_each(?))
    `,
    params: [
      ...subjectScopeParams(manifest),
      manifest.sectionIdsJson,
    ],
  };
}

function staleCourseGenEdStatement(
  manifest: SubjectSnapshotManifest
): SnapshotSqlStatement {
  return {
    sql: `
      DELETE FROM course_gened
      WHERE course_id IN (
        SELECT id FROM courses
        WHERE subject = ? AND year = ? AND term = ?
      )
      AND NOT EXISTS (
        SELECT 1
        FROM json_each(?) current_gened
        WHERE json_extract(current_gened.value, '$.courseId') = course_gened.course_id
          AND json_extract(current_gened.value, '$.categoryId') = course_gened.category_id
          AND json_extract(current_gened.value, '$.attributeCode') = course_gened.attribute_code
      )
    `,
    params: [
      ...subjectScopeParams(manifest),
      manifest.genEdKeysJson,
    ],
  };
}

function staleCourseStatement(
  manifest: SubjectSnapshotManifest
): SnapshotSqlStatement {
  return {
    sql: `
      DELETE FROM courses
      WHERE subject = ? AND year = ? AND term = ?
        AND id NOT IN (SELECT value FROM json_each(?))
    `,
    params: [
      ...subjectScopeParams(manifest),
      manifest.courseIdsJson,
    ],
  };
}
