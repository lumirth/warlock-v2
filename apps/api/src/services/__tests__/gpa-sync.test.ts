import { afterEach, describe, expect, it, vi } from 'vitest';
import type { D1Database, KVNamespace } from '@cloudflare/workers-types';
import { processGpaBatch, resumeGpaSync } from '../gpa-sync.js';

type SourceRow = {
  rowKey: string;
  subject: string;
  number: string;
  instructor: string | null;
  avgGpa: number;
  sampleSize: number;
};

function gpaLine(subject: string, number: string, gradeCounts: Record<number, number>, instructor: string): string {
  const parts = Array.from({ length: 21 }, () => '0');
  parts[0] = '2024';
  parts[1] = 'Spring';
  parts[2] = 'A';
  parts[3] = subject;
  parts[4] = number;
  parts[5] = 'Course Title';
  parts[6] = 'Primary';
  for (const [index, count] of Object.entries(gradeCounts)) {
    parts[Number(index)] = String(count);
  }
  parts[20] = `"${instructor}"`;
  return parts.join(',');
}

function statsKey(subject: string, number: string, instructor: string | null): string {
  return `${subject}\0${number}\0${instructor ?? ''}`;
}

function createGpaDb(syncState?: { cursor: number; items_synced: number; etag: string | null }) {
  const sourceRows = new Map<string, SourceRow>();
  const gpaStats = new Map<string, { avgGpa: number; sampleSize: number }>();
  const syncStateWrites: unknown[][] = [];

  function run(sql: string, params: unknown[]) {
    if (sql.includes('INSERT INTO gpa_source_rows')) {
      const [rowKey, subject, number, instructor, avgGpa, sampleSize] = params as [string, string, string, string | null, number, number];
      sourceRows.set(rowKey, { rowKey, subject, number, instructor, avgGpa, sampleSize });
    } else if (sql.includes('DELETE FROM gpa_stats') && sql.includes('subject = ?')) {
      const [subject, number, instructor] = params as [string, string, string | null, string | null];
      gpaStats.delete(statsKey(subject, number, instructor));
    } else if (sql.includes('INSERT INTO gpa_stats') && sql.includes('FROM gpa_source_rows')) {
      const [subject, number, instructor] = params as [string, string, string | null, string | null];
      const rows = Array.from(sourceRows.values()).filter(row =>
        row.subject === subject && row.number === number && row.instructor === instructor
      );
      const sampleSize = rows.reduce((total, row) => total + row.sampleSize, 0);
      const weightedPoints = rows.reduce((total, row) => total + row.avgGpa * row.sampleSize, 0);
      if (sampleSize > 0) {
        gpaStats.set(statsKey(subject, number, instructor), {
          avgGpa: weightedPoints / sampleSize,
          sampleSize,
        });
      }
    } else if (sql.includes('INSERT INTO sync_state')) {
      syncStateWrites.push(params);
    }
    return { success: true };
  }

  const db = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...params: unknown[]) => ({
        first: vi.fn(async () => {
          if (sql.includes('SELECT * FROM sync_state')) {
            return syncState
              ? { id: 'gpa', last_sync: null, last_status: 'running', ...syncState }
              : null;
          }
          return null;
        }),
        run: vi.fn(async () => run(sql, params)),
      })),
      run: vi.fn(async () => run(sql, [])),
    })),
    batch: vi.fn(async (statements: Array<{ run: () => Promise<unknown> }>) => {
      for (const statement of statements) {
        await statement.run();
      }
      return [];
    }),
  };

  return { db: db as unknown as D1Database, gpaStats, syncStateWrites };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('gpa sync', () => {
  it('idempotently aggregates repeated course/instructor rows', async () => {
    const { db, gpaStats } = createGpaDb();
    const lines = [
      gpaLine('CS', '225', { 8: 1 }, 'Lovelace, Ada'),
      gpaLine('CS', '225', { 11: 1 }, 'Lovelace, Ada'),
    ];

    await processGpaBatch(db, lines);
    await processGpaBatch(db, lines);

    expect(gpaStats.get(statsKey('CS', '225', 'Lovelace, A'))).toEqual({
      avgGpa: 3.5,
      sampleSize: 2,
    });
    expect(db.prepare).not.toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE'));
  });

  it('writes GPA sync timestamps in Unix seconds', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-03T12:00:00Z'));
    const { db, syncStateWrites } = createGpaDb({ cursor: 3, items_synced: 2, etag: null });
    const kv = {
      get: vi.fn(async () => 'abc'),
      delete: vi.fn(async () => undefined),
    } as unknown as KVNamespace;

    await resumeGpaSync(db, kv);

    expect(syncStateWrites[0]?.[1]).toBe(1780488000);
    expect(syncStateWrites[0]?.[2]).toBe('complete');
  });
});
