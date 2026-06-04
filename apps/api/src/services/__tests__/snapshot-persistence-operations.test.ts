import { describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import type { SubjectSnapshot } from '../../transforms/course.js';
import {
  escapeSqlValue,
  prepareSnapshotOperation,
  snapshotOperationStatement,
  snapshotOperationsSqlStatements,
  subjectSnapshotPersistencePlan,
} from '../snapshot-persistence-operations.js';
import { subjectSnapshotSqlStatements } from '../course-snapshot-writer.js';

function sampleSnapshot(): SubjectSnapshot {
  return {
    subject: {
      id: 'AAS',
      name: 'Asian American Studies',
      college_code: 'KV',
      department_code: '1234',
      unit_name: 'Asian American Studies',
      contact_name: "O'Brien",
      contact_title: null,
      address_line1: null,
      address_line2: null,
      phone_number: null,
      website_url: null,
      description: 'Line one\nLine two',
      last_synced: 1780000000,
    },
    termId: '2026-spring',
    year: 2026,
    term: 'spring',
    syncTimestamp: 1780000000,
    courses: [
      {
        course: {
          id: 'AAS-100-2026-spring',
          subject: 'AAS',
          number: '100',
          title: 'Intro Asian American Studies',
          description: 'Culture and history.',
          credit_hours: 3,
          year: 2026,
          term: 'spring',
          avg_gpa: 3.62,
          gpa_sample_size: 80,
          primary_instructor: 'Lee, A',
          primary_instructor_rmp: null,
          difficulty_score: 28,
          quality_score: 82,
          subject_id: 'AAS',
          course_info: 'No listed prerequisite.',
          degree_attributes: 'Cultural Studies.',
          class_schedule_info: null,
          date_range_text: null,
          registration_notes: null,
          approval_code: null,
          last_synced: 1780000000,
        },
        genEdCategories: [
          {
            categoryId: 'CS',
            categoryName: 'Cultural Studies',
            attributeCode: 'US',
            attributeName: 'US Minority Cultures',
          },
          {
            categoryId: 'HUM',
            categoryName: 'Humanities - Lit Arts',
            attributeCode: null,
            attributeName: null,
          },
        ],
        sections: [
          {
            section: {
              id: '2026-spring-12345',
              crn: '12345',
              course_id: 'AAS-100-2026-spring',
              term_id: '2026-spring',
              section_number: 'AL1',
              status: 'Open',
              type: 'Lecture',
              days: 'MWF',
              start_time: '13:00',
              end_time: '13:50',
              location: 'Lincoln Hall 1000',
              instructor: 'Lee, A',
              instructor_rmp: null,
              instructor_gpa: null,
              last_synced: 1780000000,
              section_title: 'Lecture 1',
              status_code: 'A',
              section_status_code: 'A',
              section_text: 'Lecture notes.',
              section_notes: 'Majors first.',
              capp_area: null,
              date_range_text: 'Jan 20 - Mar 13',
              part_of_term: 'A',
              start_date: '2026-01-20',
              end_date: '2026-03-13',
              credit_hours: '3',
            },
            meetings: [
              {
                section_id: '2026-spring-12345',
                meeting_index: 0,
                type_code: 'LEC',
                type_name: 'Lecture',
                days: 'MWF',
                start_time: '13:00',
                end_time: '13:50',
                building_name: 'Lincoln Hall',
                room_number: '1000',
                date_range_text: 'Jan 20 - Mar 13',
                instructors: [{ firstName: 'Ada', lastName: 'Lee' }],
              },
              {
                section_id: '2026-spring-12345',
                meeting_index: 1,
                type_code: 'DIS',
                type_name: 'Discussion',
                days: 'F',
                start_time: '14:00',
                end_time: '14:50',
                building_name: 'Lincoln Hall',
                room_number: '1001',
                date_range_text: 'Jan 20 - Mar 13',
                instructors: [{ firstName: 'Ada', lastName: 'Lee' }],
              },
            ],
          },
        ],
      },
    ],
  };
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

function renderBoundSql(sql: string, params: unknown[]): string {
  let paramIndex = 0;
  const rendered = sql.replace(/\?/g, () => {
    const value = params[paramIndex++];
    if (typeof value === 'number') return String(value);
    if (value === null || typeof value === 'string') return escapeSqlValue(value);
    throw new Error(`Unsupported test SQL param ${String(value)}`);
  });
  expect(paramIndex).toBe(params.length);
  return `${normalizeSql(rendered)};`;
}

function captureD1PreparedStatements(operations: ReturnType<typeof subjectSnapshotPersistencePlan>['operations']) {
  const prepared: { sql: string; params: unknown[] }[] = [];
  const db = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...params: unknown[]) => {
        prepared.push({ sql: normalizeSql(sql), params });
        return { run: vi.fn(async () => ({})) };
      }),
    })),
  } as unknown as D1Database;

  for (const operation of operations) {
    prepareSnapshotOperation(db, operation);
  }

  return prepared;
}

describe('snapshot persistence operations', () => {
  it('compiles snapshots into typed writes and stale-prune operations', () => {
    const kinds = subjectSnapshotPersistencePlan(sampleSnapshot()).operations.map(
      operation => operation.kind
    );

    expect(kinds).toEqual([
      'subject.upsert',
      'course.upsert',
      'course_gened.upsert',
      'course_gened.delete_null_attribute',
      'course_gened.upsert',
      'course_gened.prune_stale',
      'section.upsert',
      'meeting.upsert',
      'meeting.upsert',
      'instructor.upsert',
      'meeting_instructor.link',
      'meeting_instructor.link',
      'subject.prune_stale_meeting_instructors',
      'subject.prune_stale_meetings',
      'subject.prune_stale_sections',
      'subject.prune_stale_course_geneds',
      'subject.prune_stale_courses',
    ]);
  });

  it('renders D1 prepared statements and raw SQL from the same operation statements', () => {
    const operations = subjectSnapshotPersistencePlan(sampleSnapshot()).operations;
    const canonicalStatements = operations.map(snapshotOperationStatement);
    const d1Prepared = captureD1PreparedStatements(operations);
    const rawSql = snapshotOperationsSqlStatements(operations);

    expect(d1Prepared).toEqual(
      canonicalStatements.map(statement => ({
        sql: normalizeSql(statement.sql),
        params: statement.params,
      }))
    );
    expect(rawSql).toEqual(
      canonicalStatements.map(statement =>
        renderBoundSql(statement.sql, statement.params)
      )
    );
  });

  it('includes subject-level stale cleanup in generated snapshot SQL', () => {
    const sql = subjectSnapshotSqlStatements(sampleSnapshot());

    expect(sql.slice(-5).map(statement => statement.replace(/\s+/g, ' '))).toEqual([
      expect.stringContaining('DELETE FROM meeting_instructors WHERE meeting_id IN'),
      expect.stringContaining('DELETE FROM meetings WHERE section_id IN'),
      expect.stringContaining('DELETE FROM sections WHERE course_id IN'),
      expect.stringContaining('DELETE FROM course_gened WHERE course_id IN'),
      expect.stringContaining('DELETE FROM courses WHERE subject ='),
    ]);
  });
});
