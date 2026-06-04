import type { D1Database } from '@cloudflare/workers-types';
import { normalizeInstructorFirstName } from './instructor-name.js';
import type { Instructor } from './types.js';

export async function createInstructor(
  db: D1Database,
  instructor: { firstName?: string | null; lastName: string; displayName: string }
): Promise<number> {
  const result = await db.prepare(`
    INSERT INTO instructors (first_name, last_name, display_name)
    VALUES (?, ?, ?)
    RETURNING id
  `)
    .bind(normalizeInstructorFirstName(instructor.firstName), instructor.lastName, instructor.displayName)
    .first<{ id: number }>();

  return result!.id;
}

export function prepareUpsertInstructor(
  db: D1Database,
  instructor: Omit<Instructor, 'id'>
): D1PreparedStatement {
  return db.prepare(`
    INSERT INTO instructors (first_name, last_name, display_name, rmp_rating,
                             rmp_difficulty, avg_gpa, gpa_sample_size)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(last_name, first_name) DO UPDATE SET
      display_name = excluded.display_name,
      rmp_rating = excluded.rmp_rating,
      rmp_difficulty = excluded.rmp_difficulty,
      avg_gpa = excluded.avg_gpa,
      gpa_sample_size = excluded.gpa_sample_size
  `).bind(
    normalizeInstructorFirstName(instructor.first_name), instructor.last_name, instructor.display_name,
    instructor.rmp_rating, instructor.rmp_difficulty, instructor.avg_gpa,
    instructor.gpa_sample_size
  );
}

export async function upsertInstructor(
  db: D1Database,
  instructor: Omit<Instructor, 'id'>
): Promise<number> {
  const existing = await getInstructorByName(db, instructor.last_name, instructor.first_name);

  if (existing) {
    await db.prepare(`
      UPDATE instructors SET
        display_name = ?,
        rmp_rating = ?,
        rmp_difficulty = ?,
        avg_gpa = ?,
        gpa_sample_size = ?
      WHERE id = ?
  `).bind(
      instructor.display_name,
      instructor.rmp_rating,
      instructor.rmp_difficulty,
      instructor.avg_gpa,
      instructor.gpa_sample_size,
      existing.id
    ).run();
    return existing.id;
  }

  const result = await db.prepare(`
    INSERT INTO instructors (first_name, last_name, display_name, rmp_rating,
                             rmp_difficulty, avg_gpa, gpa_sample_size)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).bind(
    normalizeInstructorFirstName(instructor.first_name), instructor.last_name, instructor.display_name,
    instructor.rmp_rating, instructor.rmp_difficulty, instructor.avg_gpa,
    instructor.gpa_sample_size
  ).first<{ id: number }>();

  if (!result) {
    throw new Error('Failed to insert instructor');
  }

  return result.id;
}

export async function getInstructorByName(
  db: D1Database,
  lastName: string,
  firstName: string | null
): Promise<Instructor | null> {
  return db.prepare(`
    SELECT * FROM instructors WHERE last_name = ? AND first_name = ?
  `).bind(lastName, normalizeInstructorFirstName(firstName)).first<Instructor>();
}
