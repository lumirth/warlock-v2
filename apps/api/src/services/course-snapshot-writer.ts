import type { D1Database } from '@cloudflare/workers-types';
import { normalizeInstructorFirstName } from '../db/instructor-name.js';
import { formatInstructorName, type SubjectSnapshot } from '../transforms/course.js';

type SqlValue = string | number | null;
type JsonRow = readonly SqlValue[];
type Row = Record<string, SqlValue | undefined>;
type Counts = { coursesCount: number; sectionsCount: number };
export type SubjectSnapshotPublicationFence = {
  termId: string;
  subject: string;
  ownerToken: string;
};

const MAX_JSON_BYTES = 128 * 1024;
const MAX_SET_BINDS = 90;

export async function writeSubjectSnapshotToD1(
  db: D1Database,
  snapshot: SubjectSnapshot,
  options: { publicationFence?: SubjectSnapshotPublicationFence } = {},
): Promise<Counts> {
  validateSnapshot(snapshot, options.publicationFence);
  const plan = publicationPlan(db, snapshot);
  await publish(db, [...plan.writes, ...plan.deletes], options.publicationFence);
  return { coursesCount: snapshot.courses.length, sectionsCount: plan.sectionsCount };
}

function publicationPlan(db: D1Database, snapshot: SubjectSnapshot) {
  const courses: Row[] = [];
  const geneds: Row[] = [];
  const sections: Row[] = [];
  const meetings: Row[] = [];
  const links: JsonRow[] = [];
  const instructors = new Map<string, Row>();

  for (const item of snapshot.courses) {
    courses.push(row(item.course));
    for (const gened of item.genEdCategories) {
      geneds.push({
        course_id: item.course.id,
        category_id: gened.categoryId,
        category_name: gened.categoryName,
        attribute_code: gened.attributeCode ?? '',
        attribute_name: gened.attributeName,
      });
    }
    for (const itemSection of item.sections) {
      sections.push(row(itemSection.section));
      collectMeetings(itemSection.meetings, meetings, instructors, links);
    }
  }

  const writes = [
    ...bulkUpserts(db, 'subjects', [row(snapshot.subject)], COLUMNS.subjects, ['id']),
    ...bulkUpserts(db, 'courses', courses, COLUMNS.courses, ['id'], COURSE_METRICS),
    ...bulkUpserts(db, 'course_gened', geneds, COLUMNS.geneds, ['course_id', 'category_id', 'attribute_code']),
    ...bulkUpserts(db, 'sections', sections, COLUMNS.sections, ['id']),
    ...bulkUpserts(db, 'meetings', meetings, COLUMNS.meetings, ['section_id', 'meeting_index']),
    ...bulkUpserts(db, 'instructors', [...instructors.values()], COLUMNS.instructors, ['last_name', 'first_name']),
    ...linkInstructors(db, links),
  ];
  const scope = [snapshot.subject.id, snapshot.year, snapshot.term] as const;
  const deletes = staleDeletes(db, scope, {
    courses: courses.map(item => [item.id ?? null]),
    geneds: geneds.map(item => [item.course_id ?? null, item.category_id ?? null, item.attribute_code ?? null]),
    sections: sections.map(item => [item.id ?? null]),
    meetings: meetings.map(item => [item.section_id ?? null, item.meeting_index ?? null]),
    links,
  });
  return { writes, deletes, sectionsCount: sections.length };
}

function collectMeetings(
  source: SubjectSnapshot['courses'][number]['sections'][number]['meetings'],
  meetings: Row[],
  instructors: Map<string, Row>,
  links: JsonRow[],
): void {
  for (const meetingItem of source) {
    const { instructors: meetingInstructors, ...meeting } = meetingItem;
    meetings.push(row(meeting));
    for (const instructor of meetingInstructors) {
      const firstName = normalizeInstructorFirstName(instructor.firstName);
      instructors.set(`${instructor.lastName}\0${firstName}`, {
        first_name: firstName,
        last_name: instructor.lastName,
        display_name: formatInstructorName(instructor) ?? instructor.lastName,
      });
      links.push([meeting.section_id, meeting.meeting_index, instructor.lastName, firstName]);
    }
  }
}

function bulkUpserts(
  db: D1Database,
  table: string,
  rows: readonly Row[],
  columns: readonly string[],
  conflict: readonly string[],
  preserve: readonly string[] = [],
): D1PreparedStatement[] {
  if (!rows.length) return [];
  const selected = columns.map((_, index) => `json_extract(value, '$[${index}]')`).join(', ');
  const updates = columns
    .filter(column => !conflict.includes(column) && !preserve.includes(column))
    .map(column => `${column} = excluded.${column}`);
  const sql = `INSERT INTO ${table} (${columns.join(', ')})`
    + ` SELECT ${selected} FROM json_each(?) WHERE true`
    + ` ON CONFLICT(${conflict.join(', ')}) DO ${updates.length ? `UPDATE SET ${updates.join(', ')}` : 'NOTHING'}`;
  const data = rows.map(item => columns.map(column => item[column] ?? null));
  return jsonPayloads(data).map(payload => db.prepare(sql).bind(payload));
}

function linkInstructors(db: D1Database, links: readonly JsonRow[]): D1PreparedStatement[] {
  if (!links.length) return [];
  const sql = `
    INSERT INTO meeting_instructors (meeting_id, instructor_id)
    SELECT m.id, i.id FROM json_each(?) item
    JOIN meetings m ON m.section_id = json_extract(item.value, '$[0]')
      AND m.meeting_index = json_extract(item.value, '$[1]')
    JOIN instructors i ON i.last_name = json_extract(item.value, '$[2]')
      AND i.first_name = json_extract(item.value, '$[3]')
    WHERE true ON CONFLICT(meeting_id, instructor_id) DO NOTHING
  `;
  return jsonPayloads(links).map(payload => db.prepare(sql).bind(payload));
}

function staleDeletes(
  db: D1Database,
  scope: readonly [string, number, string],
  current: {
    courses: readonly JsonRow[];
    geneds: readonly JsonRow[];
    sections: readonly JsonRow[];
    meetings: readonly JsonRow[];
    links: readonly JsonRow[];
  },
): D1PreparedStatement[] {
  return [
    setDelete(db, scope, current.links, `
      DELETE FROM meeting_instructors
      WHERE meeting_id IN (
        SELECT m.id FROM meetings m JOIN sections s ON s.id = m.section_id
        JOIN courses c ON c.id = s.course_id
        WHERE c.subject = ? AND c.year = ? AND c.term = ?
      ) AND NOT EXISTS (
        SELECT 1 FROM current item JOIN meetings m ON m.id = meeting_instructors.meeting_id
        JOIN instructors i ON i.id = meeting_instructors.instructor_id
        WHERE json_extract(item.value, '$[0]') = m.section_id
          AND json_extract(item.value, '$[1]') = m.meeting_index
          AND json_extract(item.value, '$[2]') = i.last_name
          AND json_extract(item.value, '$[3]') = i.first_name
      )
    `),
    setDelete(db, scope, current.meetings, `
      DELETE FROM meetings
      WHERE section_id IN (
        SELECT s.id FROM sections s JOIN courses c ON c.id = s.course_id
        WHERE c.subject = ? AND c.year = ? AND c.term = ?
      ) AND NOT EXISTS (
        SELECT 1 FROM current item
        WHERE json_extract(item.value, '$[0]') = meetings.section_id
          AND json_extract(item.value, '$[1]') = meetings.meeting_index
      )
    `),
    setDelete(db, scope, current.sections, `
      DELETE FROM sections WHERE course_id IN (
        SELECT id FROM courses WHERE subject = ? AND year = ? AND term = ?
      ) AND id NOT IN (
        SELECT CAST(json_extract(value, '$[0]') AS TEXT) FROM current
      )
    `),
    setDelete(db, scope, current.geneds, `
      DELETE FROM course_gened WHERE course_id IN (
        SELECT id FROM courses WHERE subject = ? AND year = ? AND term = ?
      ) AND NOT EXISTS (
        SELECT 1 FROM current item
        WHERE json_extract(item.value, '$[0]') = course_gened.course_id
          AND json_extract(item.value, '$[1]') = course_gened.category_id
          AND json_extract(item.value, '$[2]') = course_gened.attribute_code
      )
    `),
    setDelete(db, scope, current.courses, `
      DELETE FROM courses WHERE subject = ? AND year = ? AND term = ?
        AND id NOT IN (
          SELECT CAST(json_extract(value, '$[0]') AS TEXT) FROM current
        )
    `),
  ];
}

function setDelete(
  db: D1Database,
  scope: readonly [string, number, string],
  rows: readonly JsonRow[],
  sql: string,
): D1PreparedStatement {
  const payloads = jsonPayloads(rows);
  assertSnapshot(payloads.length <= MAX_SET_BINDS, 'oversized subject snapshot');
  const current = payloads.map(() => 'SELECT value FROM json_each(?)').join(' UNION ALL ');
  return db.prepare(`WITH current(value) AS (${current}) ${sql}`).bind(...payloads, ...scope);
}

function jsonPayloads(rows: readonly JsonRow[]): string[] {
  if (!rows.length) return ['[]'];
  const encoder = new TextEncoder();
  const payloads: string[] = [];
  let parts: string[] = [];
  let bytes = 2;
  for (const row of rows) {
    const serialized = JSON.stringify(row);
    const rowBytes = encoder.encode(serialized).byteLength;
    assertSnapshot(rowBytes + 2 <= MAX_JSON_BYTES, 'oversized snapshot row');
    if (parts.length && bytes + rowBytes + 1 > MAX_JSON_BYTES) {
      payloads.push(`[${parts.join(',')}]`);
      parts = [];
      bytes = 2;
    }
    parts.push(serialized);
    bytes += rowBytes + (parts.length > 1 ? 1 : 0);
  }
  payloads.push(`[${parts.join(',')}]`);
  return payloads;
}

async function publish(
  db: D1Database,
  statements: D1PreparedStatement[],
  fence?: SubjectSnapshotPublicationFence,
): Promise<void> {
  if (!fence) {
    await db.batch(statements);
    return;
  }
  const values = [fence.termId, fence.subject, fence.ownerToken] as const;
  await db.batch([
    db.prepare(`
      INSERT INTO subject_sync_publication_fences (term_id, subject, owner_token)
      VALUES (?, ?, ?)
    `).bind(...values),
    db.prepare(`
      UPDATE subject_sync_state SET last_sync = unixepoch()
      WHERE term_id = ? AND subject = ? AND owner_token = ? AND status = 'running'
    `).bind(...values),
    ...statements,
    db.prepare(`
      DELETE FROM subject_sync_publication_fences
      WHERE term_id = ? AND subject = ? AND owner_token = ?
    `).bind(...values),
  ]);
}

function row(value: object): Row {
  return value as Row;
}

function validateSnapshot(snapshot: SubjectSnapshot, fence?: SubjectSnapshotPublicationFence): void {
  const subject = snapshot.subject.id.trim().toUpperCase();
  assertSnapshot(Boolean(subject), 'empty subject');
  assertSnapshot(Boolean(snapshot.courses.length), 'empty subject');
  assertSnapshot(snapshot.termId === `${snapshot.year}-${snapshot.term}`, 'inconsistent term');
  if (fence) {
    assertSnapshot(fence.subject.trim().toUpperCase() === subject, 'lease subject mismatch');
    assertSnapshot(fence.termId === snapshot.termId, 'lease term mismatch');
  }
  const courseIds = new Set<string>();
  const sectionIds = new Set<string>();
  let sections = 0;
  for (const item of snapshot.courses) {
    assertSnapshot(item.course.subject.toUpperCase() === subject, `course ${item.course.id}`);
    assertSnapshot(item.course.subject_id?.toUpperCase() === subject, `course ${item.course.id}`);
    assertSnapshot(item.course.year === snapshot.year && item.course.term === snapshot.term, `course ${item.course.id}`);
    assertSnapshot(!courseIds.has(item.course.id), `duplicate course ${item.course.id}`);
    courseIds.add(item.course.id);
    for (const { section } of item.sections) {
      assertSnapshot(section.course_id === item.course.id, `section ${section.id}`);
      assertSnapshot(section.term_id === snapshot.termId, `section ${section.id}`);
      assertSnapshot(!sectionIds.has(section.id), `duplicate section ${section.id}`);
      sectionIds.add(section.id);
    }
    sections += item.sections.length;
  }
  assertSnapshot(Boolean(sections), 'subject without sections');
}

function assertSnapshot(condition: boolean, detail: string): asserts condition {
  if (!condition) throw new Error(`refusing ${detail}`);
}

const COURSE_METRICS = [
  'avg_gpa', 'gpa_sample_size', 'primary_instructor_rmp',
  'difficulty_score', 'quality_score',
] as const;

const COLUMNS = {
  subjects: 'id name'.split(' '),
  courses: `id subject number title description credit_hours subject_id course_info
    degree_attributes class_schedule_info date_range_text registration_notes approval_code
    year term avg_gpa gpa_sample_size primary_instructor primary_instructor_rmp
    difficulty_score quality_score credit_hours_text`.split(/\s+/),
  geneds: 'course_id category_id category_name attribute_code attribute_name'.split(' '),
  sections: `id crn course_id term_id section_number status type days start_time end_time
    location section_title status_code section_status_code section_text section_notes
    capp_area date_range_text part_of_term start_date end_date credit_hours instructor last_synced`.split(/\s+/),
  meetings: `section_id meeting_index type_code type_name days start_time end_time
    building_name room_number date_range_text`.split(/\s+/),
  instructors: 'first_name last_name display_name'.split(' '),
} as const;
