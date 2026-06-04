import type { D1Database } from '@cloudflare/workers-types';
import type { Course } from './types.js';

export function prepareUpsertCourse(
  db: D1Database,
  course: Omit<Course, 'created_at' | 'updated_at'>
): D1PreparedStatement {
  return db.prepare(`
    INSERT INTO courses (
      id, subject, number, title, description, credit_hours,
      subject_id, course_info, degree_attributes, class_schedule_info,
      date_range_text, registration_notes, approval_code,
      year, term, avg_gpa, gpa_sample_size, primary_instructor,
      primary_instructor_rmp, difficulty_score, quality_score, last_synced
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      credit_hours = excluded.credit_hours,
      subject_id = excluded.subject_id,
      course_info = excluded.course_info,
      degree_attributes = excluded.degree_attributes,
      class_schedule_info = excluded.class_schedule_info,
      date_range_text = excluded.date_range_text,
      registration_notes = excluded.registration_notes,
      approval_code = excluded.approval_code,
      primary_instructor = excluded.primary_instructor,
      last_synced = excluded.last_synced,
      updated_at = unixepoch()
  `).bind(
    course.id, course.subject, course.number, course.title, course.description,
    course.credit_hours, course.subject_id, course.course_info,
    course.degree_attributes, course.class_schedule_info, course.date_range_text,
    course.registration_notes, course.approval_code, course.year, course.term,
    course.avg_gpa, course.gpa_sample_size, course.primary_instructor, course.primary_instructor_rmp,
    course.difficulty_score, course.quality_score, course.last_synced
  );
}

export async function upsertCourse(
  db: D1Database,
  course: Omit<Course, 'created_at' | 'updated_at'>
): Promise<void> {
  await prepareUpsertCourse(db, course).run();
}

export async function getCoursesBySubject(
  db: D1Database,
  subject: string,
  year: number,
  term: string
): Promise<Course[]> {
  const result = await db.prepare(`
    SELECT * FROM courses WHERE subject = ? AND year = ? AND term = ?
  `).bind(subject, year, term).all<Course>();
  return result.results;
}

export async function getCourseCount(db: D1Database): Promise<number> {
  const result = await db.prepare('SELECT COUNT(*) as count FROM courses').first<{ count: number }>();
  return result?.count ?? 0;
}
