import type { D1Database } from '@cloudflare/workers-types';

export interface Subject {
  id: string;
  name: string;
  college_code: string | null;
  department_code: string | null;
  unit_name: string | null;
  contact_name: string | null;
  contact_title: string | null;
  address_line1: string | null;
  address_line2: string | null;
  phone_number: string | null;
  website_url: string | null;
  description: string | null;
  last_synced: number | null;
}

export interface Instructor {
  id: number;
  first_name: string | null;
  last_name: string;
  display_name: string;
  rmp_rating: number | null;
  rmp_difficulty: number | null;
  avg_gpa: number | null;
  gpa_sample_size: number | null;
}

export interface Meeting {
  id: number;
  section_crn: string;
  meeting_index: number;
  type_code: string | null;
  type_name: string | null;
  days: string | null;
  start_time: string | null;
  end_time: string | null;
  building_name: string | null;
  room_number: string | null;
  date_range_text: string | null;
}

export interface CourseGened {
  id: number;
  course_id: string;
  category_id: string;
  category_name: string | null;
  attribute_code: string | null;
  attribute_name: string | null;
}

export interface Course {
  id: string;
  subject: string;
  number: string;
  title: string;
  description: string | null;
  credit_hours: number | null;
  gened: string | null;
  year: number;
  term: string;
  avg_gpa: number | null;
  gpa_sample_size: number | null;
  primary_instructor: string | null;
  primary_instructor_rmp: number | null;
  difficulty_score: number | null;
  quality_score: number | null;
  subject_id: string | null;
  course_info: string | null;
  degree_attributes: string | null;
  class_schedule_info: string | null;
  date_range_text: string | null;
  registration_notes: string | null;
  approval_code: string | null;
  last_synced: number | null;
  created_at: number;
  updated_at: number;
}

export interface Section {
  crn: string;
  course_id: string;
  section_number: string | null;
  status: string | null;
  type: string | null;
  days: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  instructor: string | null;
  instructor_rmp: number | null;
  instructor_gpa: number | null;
  last_synced: number | null;
}

export interface TermState {
  term_id: string;
  year: number;
  term: string;
  status: 'active' | 'historical';
  last_checked: number | null;
  last_synced: number | null;
  subjects_count: number | null;
  courses_count: number | null;
  sections_count: number | null;
  sync_errors: string | null;
  created_at: number;
  updated_at: number;
}

export function makeCourseId(subject: string, number: string, year: number, term: string): string {
  return `${subject}-${number}-${year}-${term}`;
}

export function makeTermId(year: number, term: string): string {
  return `${year}-${term}`;
}

export async function upsertCourse(db: D1Database, course: Omit<Course, 'created_at' | 'updated_at'>): Promise<void> {
  await db.prepare(`
    INSERT INTO courses (id, subject, number, title, description, credit_hours, gened, year, term,
                         avg_gpa, gpa_sample_size, primary_instructor, primary_instructor_rmp,
                         difficulty_score, quality_score, last_synced)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      credit_hours = excluded.credit_hours,
      gened = excluded.gened,
      avg_gpa = excluded.avg_gpa,
      gpa_sample_size = excluded.gpa_sample_size,
      primary_instructor = excluded.primary_instructor,
      primary_instructor_rmp = excluded.primary_instructor_rmp,
      difficulty_score = excluded.difficulty_score,
      quality_score = excluded.quality_score,
      last_synced = excluded.last_synced,
      updated_at = unixepoch()
  `).bind(
    course.id, course.subject, course.number, course.title, course.description,
    course.credit_hours, course.gened, course.year, course.term,
    course.avg_gpa, course.gpa_sample_size, course.primary_instructor, course.primary_instructor_rmp,
    course.difficulty_score, course.quality_score, course.last_synced
  ).run();
}

export async function upsertSection(db: D1Database, section: Section): Promise<void> {
  await db.prepare(`
    INSERT INTO sections (crn, course_id, section_number, status, type, days,
                          start_time, end_time, location, instructor,
                          instructor_rmp, instructor_gpa, last_synced)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(crn) DO UPDATE SET
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
      last_synced = excluded.last_synced
  `).bind(
    section.crn, section.course_id, section.section_number, section.status,
    section.type, section.days, section.start_time, section.end_time,
    section.location, section.instructor, section.instructor_rmp,
    section.instructor_gpa, section.last_synced
  ).run();
}

export async function getCoursesBySubject(db: D1Database, subject: string, year: number, term: string): Promise<Course[]> {
  const result = await db.prepare(`
    SELECT * FROM courses WHERE subject = ? AND year = ? AND term = ?
  `).bind(subject, year, term).all<Course>();
  return result.results;
}

export async function getCourseCount(db: D1Database): Promise<number> {
  const result = await db.prepare('SELECT COUNT(*) as count FROM courses').first<{ count: number }>();
  return result?.count ?? 0;
}

export async function getSectionCount(db: D1Database): Promise<number> {
  const result = await db.prepare('SELECT COUNT(*) as count FROM sections').first<{ count: number }>();
  return result?.count ?? 0;
}

export async function upsertTermState(
  db: D1Database,
  termState: Omit<TermState, 'created_at' | 'updated_at'>
): Promise<void> {
  await db.prepare(`
    INSERT INTO term_state (term_id, year, term, status, last_checked, last_synced,
                            subjects_count, courses_count, sections_count, sync_errors)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(term_id) DO UPDATE SET
      status = excluded.status,
      last_checked = excluded.last_checked,
      last_synced = excluded.last_synced,
      subjects_count = excluded.subjects_count,
      courses_count = excluded.courses_count,
      sections_count = excluded.sections_count,
      sync_errors = excluded.sync_errors,
      updated_at = unixepoch()
  `).bind(
    termState.term_id, termState.year, termState.term, termState.status,
    termState.last_checked, termState.last_synced, termState.subjects_count,
    termState.courses_count, termState.sections_count, termState.sync_errors
  ).run();
}

export async function getTermsByStatus(
  db: D1Database,
  status: 'active' | 'historical'
): Promise<TermState[]> {
  const result = await db.prepare(
    'SELECT * FROM term_state WHERE status = ? ORDER BY year DESC, term'
  ).bind(status).all<TermState>();
  return result.results;
}

export async function getTermState(
  db: D1Database,
  termId: string
): Promise<TermState | null> {
  return db.prepare(
    'SELECT * FROM term_state WHERE term_id = ?'
  ).bind(termId).first<TermState>();
}
