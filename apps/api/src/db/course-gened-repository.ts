import type { D1Database } from '@cloudflare/workers-types';
import type { CourseGened } from './types.js';

export function prepareInsertCourseGened(
  db: D1Database,
  gened: Omit<CourseGened, 'id'>
): D1PreparedStatement {
  return db.prepare(`
    INSERT INTO course_gened (course_id, category_id, category_name,
                              attribute_code, attribute_name)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(course_id, category_id, attribute_code) DO UPDATE SET
      category_name = excluded.category_name,
      attribute_name = excluded.attribute_name
  `).bind(
    gened.course_id, gened.category_id, gened.category_name,
    gened.attribute_code, gened.attribute_name
  );
}

export async function insertCourseGened(
  db: D1Database,
  gened: Omit<CourseGened, 'id'>
): Promise<void> {
  if (gened.attribute_code === null) {
    await db.prepare(`
      DELETE FROM course_gened
      WHERE course_id = ?
        AND category_id = ?
        AND attribute_code IS NULL
    `).bind(gened.course_id, gened.category_id).run();
  }
  await prepareInsertCourseGened(db, gened).run();
}

export async function deleteCourseGeneds(
  db: D1Database,
  courseId: string
): Promise<void> {
  await db.prepare(
    'DELETE FROM course_gened WHERE course_id = ?'
  ).bind(courseId).run();
}

export async function getGenedsByCourse(
  db: D1Database,
  courseId: string
): Promise<CourseGened[]> {
  const result = await db.prepare(`
    SELECT * FROM course_gened WHERE course_id = ? ORDER BY category_id, attribute_code
  `).bind(courseId).all<CourseGened>();
  return result.results;
}
