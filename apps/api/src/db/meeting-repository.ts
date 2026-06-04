import type { D1Database } from '@cloudflare/workers-types';
import { normalizeInstructorFirstName } from './instructor-name.js';
import type { Meeting } from './types.js';

export function prepareUpsertMeeting(
  db: D1Database,
  meeting: Omit<Meeting, 'id'>
): D1PreparedStatement {
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

export function prepareLinkMeetingInstructor(
  db: D1Database,
  meetingId: number,
  instructorId: number
): D1PreparedStatement {
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
