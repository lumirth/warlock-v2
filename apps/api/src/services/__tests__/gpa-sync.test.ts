import { afterEach, describe, expect, it, vi } from 'vitest';
import type { D1Database, KVNamespace } from '@cloudflare/workers-types';
import {
  claimGpaCompletionEnrichment,
  resetGpaSync,
  processGpaBatch,
  resumeGpaSync,
} from '../gpa-sync.js';

type SourceRow = {
  rowKey: string;
  sourceYear: number;
  sourceTerm: string;
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

function createGpaDb(syncState?: {
  cursor: number;
  items_synced: number;
  etag: string | null;
  last_status?: 'pending' | 'running' | 'complete' | 'failed';
}) {
  const sourceRows = new Map<string, SourceRow>();
  const gpaStats = new Map<string, { avgGpa: number; sampleSize: number }>();
  const syncStateWrites: unknown[][] = [];

  function run(sql: string, params: unknown[]) {
    if (sql.includes('INSERT INTO gpa_source_rows')) {
      const [rowKey, sourceYear, sourceTerm, subject, number, instructor, avgGpa, sampleSize] = params as [
        string, number, string, string, string, string | null, number, number
      ];
      sourceRows.set(rowKey, {
        rowKey,
        sourceYear,
        sourceTerm,
        subject,
        number,
        instructor,
        avgGpa,
        sampleSize,
      });
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
    } else if (sql.includes('INSERT INTO sync_state') && params[0] === 'gpa') {
      syncStateWrites.push(params);
    }
    return { success: true, meta: { changes: 1 } };
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

  return { db: db as unknown as D1Database, gpaStats, sourceRows, syncStateWrites };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('gpa sync', () => {
  it('idempotently aggregates repeated course/instructor rows', async () => {
    const { db, gpaStats, sourceRows } = createGpaDb();
    const lines = [
      gpaLine('CS', '225', { 8: 1 }, 'Lovelace, Ada'),
      gpaLine('CS', '225', { 11: 1 }, 'Lovelace, Ada'),
    ];

    await processGpaBatch(db, lines);
    await processGpaBatch(db, lines);

    expect(gpaStats.get(statsKey('CS', '225', 'Lovelace, Ada'))).toEqual({
      avgGpa: 3.5,
      sampleSize: 2,
    });
    expect(sourceRows.size).toBe(2);
    expect([...sourceRows.values()][0]).toMatchObject({
      sourceYear: 2024,
      sourceTerm: 'spring',
    });
    expect([...sourceRows.keys()].every(key => /^[a-f0-9]{64}$/.test(key))).toBe(true);
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

  it('does not fetch or rewrite a completed GPA generation', async () => {
    const { db, syncStateWrites } = createGpaDb({
      cursor: 123,
      items_synced: 10,
      etag: '"dataset-v1"',
      last_status: 'complete',
    });
    const kv = {
      get: vi.fn(),
      delete: vi.fn(),
    } as unknown as KVNamespace;

    await expect(resumeGpaSync(db, kv)).resolves.toMatchObject({
      isComplete: true,
      completionKey: '"dataset-v1":123',
      rowsProcessed: 0,
    });
    expect(kv.get).not.toHaveBeenCalled();
    expect(syncStateWrites).toEqual([]);
  });

  it('refuses to splice a changed dataset into an in-progress byte cursor', async () => {
    const { db, sourceRows, syncStateWrites } = createGpaDb({
      cursor: 50,
      items_synced: 1,
      etag: '"dataset-v1"',
      last_status: 'running',
    });
    const kv = {
      get: vi.fn(async () => null),
      put: vi.fn(),
      delete: vi.fn(),
    } as unknown as KVNamespace;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      gpaLine('CS', '225', { 8: 1 }, 'Lovelace, Ada'),
      { status: 200, headers: { etag: '"dataset-v2"' } },
    )));

    await expect(resumeGpaSync(db, kv))
      .rejects.toThrow('dataset changed while a generation was in progress');
    expect(kv.put).not.toHaveBeenCalled();
    expect(sourceRows.size).toBe(0);
    expect(syncStateWrites).toEqual([]);
  });

  it('uses the atomic D1 write result when claiming completion enrichment', async () => {
    const run = vi.fn(async () => ({ success: true, meta: { changes: 0 } }));
    const bind = vi.fn(() => ({ run }));
    const prepare = vi.fn(() => ({ bind }));
    const db = { prepare } as unknown as D1Database;

    await expect(claimGpaCompletionEnrichment(db, 'etag:123')).resolves.toBe(false);

    const sql = String((prepare.mock.calls as unknown[][])[0]?.[0] ?? '');
    expect(sql).toContain("sync_state.last_status IN ('pending', 'failed')");
    expect(sql).toContain("sync_state.last_status = 'running'");
    expect(bind).toHaveBeenCalledWith(
      'gpa-completion-enrichment',
      'etag:123',
      expect.any(Number)
    );
  });

  it('returns busy without reading or advancing a checkpoint when another mutation holds the lease', async () => {
    const first = vi.fn();
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          run: vi.fn(async () => ({ success: true, meta: { changes: 0 } })),
          first,
        })),
      })),
    } as unknown as D1Database;
    const kv = { get: vi.fn() } as unknown as KVNamespace;

    await expect(resumeGpaSync(db, kv)).resolves.toMatchObject({
      success: false,
      message: expect.stringContaining('lease is busy'),
    });
    expect(first).not.toHaveBeenCalled();
    expect(kv.get).not.toHaveBeenCalled();
  });

  it('refuses to overwrite a checkpoint that changed after the resume read it', async () => {
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn((...params: unknown[]) => ({
          first: vi.fn(async () => sql.includes('SELECT * FROM sync_state')
            ? {
                id: 'gpa',
                last_sync: 1,
                last_status: 'running',
                items_synced: 0,
                cursor: 0,
                etag: '"dataset-v1"',
              }
            : null),
          run: vi.fn(async () => ({
            success: true,
            meta: {
              changes: sql.includes('INSERT INTO sync_state') && params[0] === 'gpa'
                ? 0
                : 1,
            },
          })),
        })),
      })),
      batch: vi.fn(async () => []),
    } as unknown as D1Database;
    const kv = {
      get: vi.fn(async () => 'not,a,valid,gpa,row'),
      delete: vi.fn(),
    } as unknown as KVNamespace;

    await expect(resumeGpaSync(db, kv))
      .rejects.toThrow('refusing cursor overwrite');
    const checkpointSql = vi.mocked(db.prepare).mock.calls
      .map(call => String(call[0]))
      .find(sql => sql.includes('COALESCE(sync_state.cursor, 0)'));
    expect(checkpointSql).toContain('sync_state.etag IS ?');
    expect(checkpointSql).toContain('sync_state.last_status IS ?');
  });

  it('makes reset FK-safe and generation replacement atomic', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', {
      status: 200,
      headers: { etag: '"dataset-v2"' },
    })));
    const batches: string[][] = [];
    const db = {
      prepare: vi.fn((sql: string) => ({
        sql,
        bind: vi.fn((...params: unknown[]) => ({
          sql,
          params,
          run: vi.fn(async () => ({ success: true, meta: { changes: 1 } })),
          first: vi.fn(async () => sql.includes('SELECT * FROM sync_state')
            ? {
                id: 'gpa',
                last_sync: 1,
                last_status: 'complete',
                items_synced: 10,
                cursor: 100,
                etag: '"dataset-v1"',
              }
            : null),
        })),
      })),
      batch: vi.fn(async (statements: Array<{ sql: string }>) => {
        batches.push(statements.map(statement => statement.sql.replace(/\s+/g, ' ').trim()));
        return [];
      }),
    } as unknown as D1Database;
    const kv = { delete: vi.fn() } as unknown as KVNamespace;

    await expect(resetGpaSync(db, kv)).resolves.toBe('reset_initiated');
    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual([
      'UPDATE instructor_course_links SET gpa_id = NULL WHERE gpa_id IS NOT NULL',
      expect.stringContaining('UPDATE courses SET avg_gpa = NULL, gpa_sample_size = NULL, quality_score = NULL'),
      'DELETE FROM gpa_source_rows',
      'DELETE FROM gpa_stats',
      expect.stringContaining("VALUES ('gpa', NULL, 'pending', 0, 0, ?)"),
    ]);
  });

  it('does not discard an incomplete generation when the upstream ETag is unchanged', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', {
      status: 200,
      headers: { etag: '"dataset-v1"' },
    })));
    const { db } = createGpaDb({
      cursor: 50,
      items_synced: 1,
      etag: '"dataset-v1"',
      last_status: 'running',
    });
    const kv = { delete: vi.fn() } as unknown as KVNamespace;

    await expect(resetGpaSync(db, kv)).resolves.toBe('skipped_no_changes');
    expect(kv.delete).not.toHaveBeenCalled();
    expect(db.batch).not.toHaveBeenCalled();
  });
});
