import { describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import type { SubjectSnapshot } from '../../transforms/course.js';
import {
  subjectSnapshotPersistencePlan,
} from '../snapshot-persistence-operations.js';
import {
  prepareSnapshotOperation,
  snapshotOperationStatement,
} from '../snapshot-persistence-sql.js';
import { writeSubjectSnapshotToD1 } from '../course-snapshot-writer.js';

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
          credit_hours_text: '3 hours.',
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

function captureD1PreparedStatements(operations: ReturnType<typeof subjectSnapshotPersistencePlan>['writeOperations']) {
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
  it('separates typed writes from destructive subject finalization', () => {
    const plan = subjectSnapshotPersistencePlan(sampleSnapshot());
    const writeKinds = plan.writeOperations.map(
      operation => operation.kind
    );
    const finalizeKinds = plan.finalizeOperations.map(
      operation => operation.kind
    );

    expect(writeKinds).toEqual([
      'subject.upsert',
      'course.upsert',
      'course_gened.upsert',
      'course_gened.upsert',
      'section.upsert',
      'meeting.upsert',
      'meeting.upsert',
      'instructor.upsert',
      'meeting_instructor.link',
      'meeting_instructor.link',
    ]);
    expect(finalizeKinds).toEqual([
      'subject.prune_stale_meeting_instructors',
      'subject.prune_stale_meetings',
      'subject.prune_stale_sections',
      'subject.prune_stale_course_geneds',
      'subject.prune_stale_courses',
    ]);

    const reconciliation = plan.finalizeOperations.find(
      operation => operation.kind === 'subject.prune_stale_meetings'
    );
    const manifest = reconciliation?.manifest;
    expect(manifest).toBeDefined();
    expect(JSON.parse(manifest?.meetingKeysJson ?? '[]')).toEqual([
      { sectionId: '2026-spring-12345', meetingIndex: 0 },
      { sectionId: '2026-spring-12345', meetingIndex: 1 },
    ]);
    expect(JSON.parse(manifest?.meetingInstructorKeysJson ?? '[]')).toEqual([
      {
        sectionId: '2026-spring-12345',
        meetingIndex: 0,
        lastName: 'Lee',
        firstName: 'Ada',
      },
      {
        sectionId: '2026-spring-12345',
        meetingIndex: 1,
        lastName: 'Lee',
        firstName: 'Ada',
      },
    ]);
  });

  it('prepares every canonical snapshot operation for D1', () => {
    const plan = subjectSnapshotPersistencePlan(sampleSnapshot());
    const operations = [...plan.writeOperations, ...plan.finalizeOperations];
    const canonicalStatements = operations.map(snapshotOperationStatement);
    const d1Prepared = captureD1PreparedStatements(operations);

    expect(d1Prepared).toEqual(
      canonicalStatements.map(statement => ({
        sql: normalizeSql(statement.sql),
        params: statement.params,
      }))
    );
  });

  it('only finalizes stale data after every write batch succeeds', async () => {
    const executedSql: string[][] = [];
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn(() => ({ sql })),
      })),
      batch: vi.fn(async (statements: Array<{ sql: string }>) => {
        executedSql.push(statements.map(statement => statement.sql));
        if (executedSql.length === 2) throw new Error('write batch failed');
        return [];
      }),
    } as unknown as D1Database;

    await expect(writeSubjectSnapshotToD1(db, sampleSnapshot(), { batchSize: 4 }))
      .rejects.toThrow('write batch failed');

    expect(executedSql.flat().some(sql => sql.startsWith('DELETE FROM courses'))).toBe(false);
  });

  it('rejects invalid write batch sizes instead of entering an invalid chunk loop', async () => {
    const db = {
      prepare: vi.fn(),
      batch: vi.fn(),
    } as unknown as D1Database;

    await expect(writeSubjectSnapshotToD1(db, sampleSnapshot(), { batchSize: 0 }))
      .rejects.toThrow('positive integer');
    expect(db.batch).not.toHaveBeenCalled();
  });

  it('commits all stale-prune operations together after chunked writes', async () => {
    const executedSql: string[][] = [];
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn(() => ({ sql })),
      })),
      batch: vi.fn(async (statements: Array<{ sql: string }>) => {
        executedSql.push(statements.map(statement => statement.sql));
        return [];
      }),
    } as unknown as D1Database;

    await writeSubjectSnapshotToD1(db, sampleSnapshot(), { batchSize: 4 });

    expect(executedSql.length).toBeGreaterThan(2);
    expect(executedSql.at(-1)).toHaveLength(5);
    expect(
      executedSql.at(-1)?.every(sql => sql.trimStart().startsWith('DELETE FROM'))
    ).toBe(true);
    expect(executedSql.slice(0, -1).flat().some(sql => sql.startsWith('DELETE FROM courses'))).toBe(false);
  });

  it('fences and renews every large-subject batch without exceeding the batch limit', async () => {
    const executedSql: string[][] = [];
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn(() => ({ sql: normalizeSql(sql) })),
      })),
      batch: vi.fn(async (statements: Array<{ sql: string }>) => {
        executedSql.push(statements.map(statement => statement.sql));
        return [];
      }),
    } as unknown as D1Database;

    await writeSubjectSnapshotToD1(db, sampleSnapshot(), {
      batchSize: 8,
      publicationFence: {
        termId: '2026-spring',
        subject: 'AAS',
        ownerToken: 'subject:current-owner',
      },
    });

    expect(executedSql.length).toBeGreaterThan(2);
    for (const transaction of executedSql) {
      expect(transaction.length).toBeLessThanOrEqual(8);
      expect(transaction[0]).toContain('INSERT INTO subject_sync_publication_fences');
      expect(transaction[1]).toContain('UPDATE subject_sync_state');
      expect(transaction.at(-1)).toContain('DELETE FROM subject_sync_publication_fences');
    }
    expect(
      executedSql.at(-1)?.some(sql => sql.startsWith('DELETE FROM courses'))
    ).toBe(true);
  });

  it('does not run destructive finalization after a fenced write batch loses ownership', async () => {
    const executedSql: string[][] = [];
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn(() => ({ sql: normalizeSql(sql) })),
      })),
      batch: vi.fn(async (statements: Array<{ sql: string }>) => {
        executedSql.push(statements.map(statement => statement.sql));
        if (executedSql.length === 2) {
          throw new Error('FOREIGN KEY constraint failed');
        }
        return [];
      }),
    } as unknown as D1Database;

    await expect(writeSubjectSnapshotToD1(db, sampleSnapshot(), {
      batchSize: 8,
      publicationFence: {
        termId: '2026-spring',
        subject: 'AAS',
        ownerToken: 'subject:stale-owner',
      },
    })).rejects.toThrow('FOREIGN KEY constraint failed');

    expect(executedSql).toHaveLength(2);
    expect(
      executedSql.flat().some(sql => sql.startsWith('DELETE FROM courses'))
    ).toBe(false);
  });

  it('refuses an empty snapshot before preparing or publishing statements', async () => {
    const db = {
      prepare: vi.fn(),
      batch: vi.fn(),
    } as unknown as D1Database;
    const snapshot = sampleSnapshot();
    snapshot.courses = [];

    await expect(writeSubjectSnapshotToD1(db, snapshot))
      .rejects.toThrow('snapshot contains no courses');
    expect(db.prepare).not.toHaveBeenCalled();
    expect(db.batch).not.toHaveBeenCalled();
  });

});
