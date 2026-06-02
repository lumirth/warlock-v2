import type { D1Database } from '@cloudflare/workers-types';

export const TERM_STATUSES = ['registrable', 'active', 'historical'] as const;
export type TermStateStatus = typeof TERM_STATUSES[number];

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
  section_id: string;
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
  id: string;
  crn: string;
  course_id: string;
  term_id: string;
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
  section_title: string | null;
  status_code: string | null;
  section_status_code: string | null;
  section_text: string | null;
  section_notes: string | null;
  capp_area: string | null;
  date_range_text: string | null;
  part_of_term: string | null;
  start_date: string | null;
  end_date: string | null;
  credit_hours: string | null;
}

export interface TermState {
  term_id: string;
  year: number;
  term: string;
  status: TermStateStatus;
  last_checked: number | null;
  last_synced: number | null;
  subjects_count: number | null;
  courses_count: number | null;
  sections_count: number | null;
  sync_errors: string | null;
  created_at: number;
  updated_at: number;
}

export interface SyncState {
  id: string;
  last_sync: number | null;
  last_status: string | null;
  items_synced: number | null;
  cursor: number | null;
  etag: string | null;
}

export async function getSyncState(db: D1Database, id: string): Promise<SyncState | null> {
  return db.prepare('SELECT * FROM sync_state WHERE id = ?').bind(id).first<SyncState>();
}

function normalizeInstructorFirstName(firstName: string | null | undefined): string {
  return firstName?.trim() ?? '';
}

export async function upsertSyncState(db: D1Database, state: SyncState): Promise<void> {
  await db.prepare(`
    INSERT INTO sync_state (id, last_sync, last_status, items_synced, cursor, etag)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      last_sync = excluded.last_sync,
      last_status = excluded.last_status,
      items_synced = excluded.items_synced,
      cursor = excluded.cursor,
      etag = excluded.etag
  `).bind(state.id, state.last_sync, state.last_status, state.items_synced, state.cursor, state.etag).run();
}

export function makeCourseId(subject: string, number: string, year: number, term: string): string {
  return `${subject}-${number}-${year}-${term}`;
}

export function makeTermId(year: number, term: string): string {
  return `${year}-${term}`;
}

export function makeSectionId(termId: string, crn: string): string {
  return `${termId}-${crn}`;
}

export function prepareUpsertCourse(db: D1Database, course: Omit<Course, 'created_at' | 'updated_at'>): D1PreparedStatement {
  return db.prepare(`
    INSERT INTO courses (id, subject, number, title, description, credit_hours, gened, year, term,
                         avg_gpa, gpa_sample_size, primary_instructor, primary_instructor_rmp,
                         difficulty_score, quality_score, last_synced)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      credit_hours = excluded.credit_hours,
      gened = excluded.gened,
      primary_instructor = excluded.primary_instructor,
      last_synced = excluded.last_synced,
      updated_at = unixepoch()
  `).bind(
    course.id, course.subject, course.number, course.title, course.description,
    course.credit_hours, course.gened, course.year, course.term,
    course.avg_gpa, course.gpa_sample_size, course.primary_instructor, course.primary_instructor_rmp,
    course.difficulty_score, course.quality_score, course.last_synced
  );
}

export async function upsertCourse(db: D1Database, course: Omit<Course, 'created_at' | 'updated_at'>): Promise<void> {
  await prepareUpsertCourse(db, course).run();
}

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
  status: TermStateStatus
): Promise<TermState[]> {
  const result = await db.prepare(
    `SELECT * FROM term_state
     WHERE status = ?
     ORDER BY year DESC,
       CASE term
         WHEN 'fall' THEN 0
         WHEN 'spring' THEN 0
         WHEN 'summer' THEN 1
         WHEN 'winter' THEN 1
         ELSE 2
       END,
       CASE term
         WHEN 'fall' THEN 4
         WHEN 'summer' THEN 3
         WHEN 'spring' THEN 2
         WHEN 'winter' THEN 1
         ELSE 0
       END DESC`
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

// Subject operations

export function prepareUpsertSubject(db: D1Database, subject: Subject): D1PreparedStatement {
  return db.prepare(`
    INSERT INTO subjects (id, name, college_code, department_code, unit_name,
                          contact_name, contact_title, address_line1, address_line2,
                          phone_number, website_url, description, last_synced)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      college_code = excluded.college_code,
      department_code = excluded.department_code,
      unit_name = excluded.unit_name,
      contact_name = excluded.contact_name,
      contact_title = excluded.contact_title,
      address_line1 = excluded.address_line1,
      address_line2 = excluded.address_line2,
      phone_number = excluded.phone_number,
      website_url = excluded.website_url,
      description = excluded.description,
      last_synced = excluded.last_synced
  `).bind(
    subject.id, subject.name, subject.college_code, subject.department_code,
    subject.unit_name, subject.contact_name, subject.contact_title,
    subject.address_line1, subject.address_line2, subject.phone_number,
    subject.website_url, subject.description, subject.last_synced
  );
}

export async function upsertSubject(db: D1Database, subject: Subject): Promise<void> {
  await prepareUpsertSubject(db, subject).run();
}

export async function getSubject(db: D1Database, id: string): Promise<Subject | null> {
  return db.prepare(
    'SELECT * FROM subjects WHERE id = ?'
  ).bind(id).first<Subject>();
}

// Instructor operations

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

export function prepareUpsertInstructor(db: D1Database, instructor: Omit<Instructor, 'id'>): D1PreparedStatement {
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
    // Update existing instructor
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

  // Insert new instructor
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

// Meeting operations

export function prepareUpsertMeeting(db: D1Database, meeting: Omit<Meeting, 'id'>): D1PreparedStatement {
  return db.prepare(`
    INSERT INTO meetings (section_id, meeting_index, type_code, type_name,
                          days, start_time, end_time, building_name,
                          room_number, date_range_text)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(section_id, meeting_index) DO UPDATE SET
      type_code = excluded.type_code,
      type_name = excluded.type_name,
      days = excluded.days,
      start_time = excluded.start_time,
      end_time = excluded.end_time,
      building_name = excluded.building_name,
      room_number = excluded.room_number,
      date_range_text = excluded.date_range_text
  `).bind(
    meeting.section_id, meeting.meeting_index, meeting.type_code, meeting.type_name,
    meeting.days, meeting.start_time, meeting.end_time, meeting.building_name,
    meeting.room_number, meeting.date_range_text
  );
}

export async function upsertMeeting(
  db: D1Database,
  meeting: Omit<Meeting, 'id'>
): Promise<number> {
  const result = await db.prepare(`
    INSERT INTO meetings (section_id, meeting_index, type_code, type_name,
                          days, start_time, end_time, building_name,
                          room_number, date_range_text)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(section_id, meeting_index) DO UPDATE SET
      type_code = excluded.type_code,
      type_name = excluded.type_name,
      days = excluded.days,
      start_time = excluded.start_time,
      end_time = excluded.end_time,
      building_name = excluded.building_name,
      room_number = excluded.room_number,
      date_range_text = excluded.date_range_text
    RETURNING id
  `).bind(
    meeting.section_id, meeting.meeting_index, meeting.type_code, meeting.type_name,
    meeting.days, meeting.start_time, meeting.end_time, meeting.building_name,
    meeting.room_number, meeting.date_range_text
  ).first<{ id: number }>();

  if (!result) {
    // If RETURNING didn't work (e.g. conflict but no update?), fetch the existing record
    const existing = await db.prepare(`
      SELECT id FROM meetings WHERE section_id = ? AND meeting_index = ?
    `).bind(meeting.section_id, meeting.meeting_index).first<{ id: number }>();

    if (!existing) {
      throw new Error('Failed to insert or retrieve meeting');
    }
    return existing.id;
  }

  return result.id;
}

export async function getMeetingsForSection(
  db: D1Database,
  sectionId: string
): Promise<Meeting[]> {
  const result = await db.prepare(`
    SELECT * FROM meetings WHERE section_id = ? ORDER BY meeting_index
  `).bind(sectionId).all<Meeting>();
  return result.results;
}

// MeetingInstructor operations

export function prepareLinkMeetingInstructor(db: D1Database, meetingId: number, instructorId: number): D1PreparedStatement {
  return db.prepare(`
    INSERT INTO meeting_instructors (meeting_id, instructor_id)
    VALUES (?, ?)
    ON CONFLICT(meeting_id, instructor_id) DO NOTHING
  `).bind(meetingId, instructorId);
}

export function prepareLinkMeetingInstructorByKeys(
  db: D1Database,
  sectionId: string,
  meetingIndex: number,
  lastName: string,
  firstName: string | null
): D1PreparedStatement {
  const params = [sectionId, meetingIndex, lastName, normalizeInstructorFirstName(firstName)];

  return db.prepare(`
    INSERT INTO meeting_instructors (meeting_id, instructor_id)
    SELECT m.id, i.id
    FROM meetings m, instructors i
    WHERE m.section_id = ? AND m.meeting_index = ?
      AND i.last_name = ? AND i.first_name = ?
    ON CONFLICT(meeting_id, instructor_id) DO NOTHING
  `).bind(...params);
}

export async function linkMeetingInstructor(
  db: D1Database,
  meetingId: number,
  instructorId: number
): Promise<void> {
  await prepareLinkMeetingInstructor(db, meetingId, instructorId).run();
}

export async function clearMeetingInstructors(
  db: D1Database,
  meetingId: number
): Promise<void> {
  await db.prepare(
    'DELETE FROM meeting_instructors WHERE meeting_id = ?'
  ).bind(meetingId).run();
}

// CourseGened operations

export function prepareInsertCourseGened(db: D1Database, gened: Omit<CourseGened, 'id'>): D1PreparedStatement {
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
