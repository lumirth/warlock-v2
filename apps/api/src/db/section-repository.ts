import type { D1Database } from '@cloudflare/workers-types';
import type { Section } from './types.js';

export function prepareUpsertSection(db: D1Database, section: Section): D1PreparedStatement {
  return db.prepare(`
    INSERT INTO sections (id, crn, course_id, term_id, section_number, status, type, days,
                          start_time, end_time, location, instructor,
                          instructor_rmp, instructor_gpa, last_synced,
                          section_title, status_code, section_status_code,
                          section_text, section_notes, capp_area, date_range_text,
                          part_of_term, start_date, end_date, credit_hours)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      crn = excluded.crn,
      course_id = excluded.course_id,
      term_id = excluded.term_id,
      section_number = excluded.section_number,
      status = excluded.status,
      type = excluded.type,
      days = excluded.days,
      start_time = excluded.start_time,
      end_time = excluded.end_time,
      location = excluded.location,
      instructor = excluded.instructor,
      instructor_rmp = excluded.instructor_rmp,
      instructor_gpa = excluded.instructor_gpa,
      last_synced = excluded.last_synced,
      section_title = excluded.section_title,
      status_code = excluded.status_code,
      section_status_code = excluded.section_status_code,
      section_text = excluded.section_text,
      section_notes = excluded.section_notes,
      capp_area = excluded.capp_area,
      date_range_text = excluded.date_range_text,
      part_of_term = excluded.part_of_term,
      start_date = excluded.start_date,
      end_date = excluded.end_date,
      credit_hours = excluded.credit_hours
  `).bind(
    section.id, section.crn, section.course_id, section.term_id, section.section_number, section.status,
    section.type, section.days, section.start_time, section.end_time,
    section.location, section.instructor, section.instructor_rmp,
    section.instructor_gpa, section.last_synced,
    section.section_title, section.status_code, section.section_status_code,
    section.section_text, section.section_notes, section.capp_area,
    section.date_range_text, section.part_of_term, section.start_date,
    section.end_date, section.credit_hours
  );
}

export async function upsertSection(db: D1Database, section: Section): Promise<void> {
  await prepareUpsertSection(db, section).run();
}

export async function getSectionCount(db: D1Database): Promise<number> {
  const result = await db.prepare('SELECT COUNT(*) as count FROM sections').first<{ count: number }>();
  return result?.count ?? 0;
}
