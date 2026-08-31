import { env } from 'cloudflare:workers';
import type { KVNamespace as WorkerKVNamespace } from '@cloudflare/workers-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  finishGpaEnrichment,
  resetGpaSync,
  resumeGpaSync,
} from '../gpa-sync.js';

const testEnv = env as {
  DB: D1Database;
  GPA_CACHE: WorkerKVNamespace;
};
const GPA_HEADER = 'Year,Term,YearTerm,Subject,Number,Course Title,Sched Type,A+,A,A-,B+,B,B-,C+,C,C-,D+,D,D-,F,W,Students,Primary Instructor';

describe('GPA generation concurrency in D1', () => {
  beforeEach(async () => {
    await testEnv.DB.prepare('PRAGMA foreign_keys = ON').run();
    await testEnv.DB.batch([
      testEnv.DB.prepare('UPDATE instructor_course_links SET gpa_id = NULL'),
      testEnv.DB.prepare("DELETE FROM instructor_course_links WHERE term_id = '2099-test'"),
      testEnv.DB.prepare('DELETE FROM gpa_source_rows'),
      testEnv.DB.prepare('DELETE FROM gpa_stats'),
      testEnv.DB.prepare(
        "DELETE FROM sync_state WHERE id IN ('gpa', 'gpa-lease')"
      ),
    ]);
    await testEnv.GPA_CACHE.delete('gpa-dataset');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps published GPA intact while clearing only the staged import', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));

    await testEnv.DB.prepare(`
      INSERT INTO gpa_stats (
        subject, number, instructor, avg_gpa, sample_size
      )
      VALUES ('TEST', '101', 'Teacher, Ada', 3.8, 40)
    `).run();
    const stat = await testEnv.DB.prepare(`
      SELECT id FROM gpa_stats
      WHERE subject = 'TEST' AND number = '101'
    `).first<{ id: number }>();
    expect(stat?.id).toEqual(expect.any(Number));

    await testEnv.DB.batch([
      testEnv.DB.prepare(`
        INSERT INTO courses (
          id, subject, number, title, year, term, avg_gpa, gpa_sample_size,
          primary_instructor_rmp, quality_score, difficulty_score
        )
        VALUES (
          'TEST-101-2099-test', 'TEST', '101', 'Generation Test',
          2099, 'test', 3.8, 40,
          4.6, 91, 24
        )
        ON CONFLICT(id) DO UPDATE SET
          avg_gpa = excluded.avg_gpa,
          gpa_sample_size = excluded.gpa_sample_size,
          primary_instructor_rmp = excluded.primary_instructor_rmp,
          quality_score = excluded.quality_score,
          difficulty_score = excluded.difficulty_score
      `),
      testEnv.DB.prepare(`
        INSERT INTO instructor_course_links (
          term_id, subject, number, instructor_name, gpa_id
        )
        VALUES ('2099-test', 'TEST', '101', 'Teacher, Ada', ?)
      `).bind(stat?.id ?? -1),
      testEnv.DB.prepare(`
        INSERT INTO gpa_source_rows (
          row_key, subject, number, instructor, avg_gpa, sample_size
        )
        VALUES (
          'legacy-row', 'TEST', '101', 'Teacher, Ada', 3.8, 40
        )
      `),
      testEnv.DB.prepare(`
        INSERT INTO sync_state (
          id, last_sync, last_status, items_synced, cursor, owner_token
        )
        VALUES ('gpa', unixepoch(), 'complete', 1, 100, NULL)
      `),
    ]);

    await expect(resetGpaSync(testEnv.DB, testEnv.GPA_CACHE))
      .resolves.toBe('reset_initiated');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(GPA_HEADER, { status: 200 })));
    await expect(resumeGpaSync(testEnv.DB, testEnv.GPA_CACHE))
      .rejects.toThrow('refusing empty GPA generation');

    const link = await testEnv.DB.prepare(`
      SELECT gpa_id FROM instructor_course_links
      WHERE term_id = '2099-test'
    `).first<{ gpa_id: number | null }>();
    const counts = await testEnv.DB.prepare(`
      SELECT
        (SELECT COUNT(*) FROM gpa_stats) AS stats_count,
        (SELECT COUNT(*) FROM gpa_source_rows) AS source_count
    `).first<{ stats_count: number; source_count: number }>();
    const state = await testEnv.DB.prepare(`
      SELECT last_status, cursor, owner_token FROM sync_state WHERE id = 'gpa'
    `).first<{ last_status: string; cursor: number; owner_token: string }>();
    const course = await testEnv.DB.prepare(`
      SELECT avg_gpa, gpa_sample_size, primary_instructor_rmp,
             quality_score, difficulty_score
      FROM courses
      WHERE id = 'TEST-101-2099-test'
    `).first<{
      avg_gpa: number | null;
      gpa_sample_size: number | null;
      primary_instructor_rmp: number | null;
      quality_score: number | null;
      difficulty_score: number | null;
    }>();

    expect(link?.gpa_id).toBe(stat?.id);
    expect(counts).toEqual({ stats_count: 1, source_count: 0 });
    expect(course).toEqual({
      avg_gpa: 3.8,
      gpa_sample_size: 40,
      primary_instructor_rmp: 4.6,
      quality_score: 91,
      difficulty_score: 24,
    });
    expect(state).toEqual({
      last_status: 'pending',
      cursor: 0,
      owner_token: expect.any(String),
    });
  });

  it('fences an expired resume owner with checkpoint CAS instead of regressing the cursor', async () => {
    const staleDataset = [
      GPA_HEADER,
      gpaLine('101'),
    ].join('\n');
    const winningDataset = [
      GPA_HEADER,
      gpaLine('102'),
    ].join('\n');
    const firstFetchStarted = deferred<void>();
    const releaseFirstFetch = deferred<void>();
    let fetchCall = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      fetchCall += 1;
      if (fetchCall === 1) {
        firstFetchStarted.resolve();
        await releaseFirstFetch.promise;
      }
      return new Response(fetchCall === 1 ? staleDataset : winningDataset, { status: 200 });
    }));

    await testEnv.DB.prepare(`
      INSERT INTO sync_state (
        id, last_sync, last_status, items_synced, cursor, owner_token
      )
      VALUES ('gpa', NULL, 'pending', 0, 0, 'generation-1')
    `).run();

    const staleOwner = resumeGpaSync(testEnv.DB, testEnv.GPA_CACHE);
    await firstFetchStarted.promise;
    await testEnv.DB.prepare(`
      UPDATE sync_state
      SET last_sync = 0
      WHERE id = 'gpa-lease' AND last_status = 'running'
    `).run();

    const winner = await resumeGpaSync(testEnv.DB, testEnv.GPA_CACHE);
    expect(winner).toMatchObject({
      success: true,
      isComplete: true,
      rowsProcessed: 1,
    });

    releaseFirstFetch.resolve();
    await expect(staleOwner).rejects.toThrow('refusing stale data write');

    const state = await testEnv.DB.prepare(`
      SELECT last_status, cursor, owner_token FROM sync_state WHERE id = 'gpa'
    `).first<{ last_status: string; cursor: number; owner_token: string }>();
    const sourceRows = await testEnv.DB.prepare(`
      SELECT number FROM gpa_source_rows
      WHERE subject = 'TEST'
      ORDER BY number
    `).all<{ number: string }>();
    const stats = await testEnv.DB.prepare(`
      SELECT number, avg_gpa, sample_size FROM gpa_stats
      WHERE subject = 'TEST' AND instructor IS NOT NULL
      ORDER BY number
    `).all<{ number: string; avg_gpa: number; sample_size: number }>();
    expect(state).toEqual({
      last_status: 'complete',
      cursor: winningDataset.length,
      owner_token: 'generation-1',
    });
    expect(sourceRows.results).toEqual([{ number: '102' }]);
    expect(stats.results).toEqual([{
      number: '102',
      avg_gpa: 4,
      sample_size: 10,
    }]);
  });

  it('rebuilds derived stats before completing an already-at-EOF checkpoint', async () => {
    const cachedDataset = 'cached-generation';
    await testEnv.GPA_CACHE.put('gpa-dataset', cachedDataset);
    await testEnv.DB.batch([
      testEnv.DB.prepare(`
        INSERT INTO gpa_source_rows (
          row_key, subject, number, instructor, avg_gpa, sample_size
        )
        VALUES
          ('source-a', 'TEST', '103', 'Teacher, Ada', 4.0, 10),
          ('source-b', 'TEST', '103', 'Teacher, Ada', 3.0, 30)
      `),
      testEnv.DB.prepare(`
        INSERT INTO sync_state (
          id, last_sync, last_status, items_synced, cursor, owner_token
        )
        VALUES ('gpa', unixepoch(), 'running', 2, ?, 'generation-2')
      `).bind(cachedDataset.length),
    ]);

    await expect(resumeGpaSync(testEnv.DB, testEnv.GPA_CACHE)).resolves.toMatchObject({
      success: true,
      isComplete: true,
      rowsProcessed: 0,
    });

    const state = await testEnv.DB.prepare(`
      SELECT last_status, cursor, items_synced FROM sync_state WHERE id = 'gpa'
    `).first<{ last_status: string; cursor: number; items_synced: number }>();
    const stats = await testEnv.DB.prepare(`
      SELECT avg_gpa, sample_size FROM gpa_stats
      WHERE subject = 'TEST' AND number = '103' AND instructor = 'Teacher, Ada'
    `).first<{ avg_gpa: number; sample_size: number }>();

    expect(state).toEqual({
      last_status: 'complete',
      cursor: cachedDataset.length,
      items_synced: 2,
    });
    expect(stats).toEqual({ avg_gpa: 3.25, sample_size: 40 });
    await expect(testEnv.GPA_CACHE.get('gpa-dataset')).resolves.toBeNull();
  });

  it('refuses to splice a resumed cursor into a newly fetched dataset', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('replacement dataset')));
    await testEnv.DB.prepare(`
      INSERT INTO sync_state (id, last_status, items_synced, cursor, owner_token)
      VALUES ('gpa', 'running', 3, 100, 'generation-3')
    `).run();

    await expect(resumeGpaSync(testEnv.DB, testEnv.GPA_CACHE))
      .rejects.toThrow('cache expired during import');
  });

  it('refuses to complete a generation replaced by a later reset', async () => {
    await testEnv.DB.prepare(`
      INSERT INTO sync_state (id, last_status, items_synced, cursor, owner_token)
      VALUES ('gpa', 'pending', 1, 100, 'obsolete-generation')
    `).run();

    await expect(resetGpaSync(testEnv.DB, testEnv.GPA_CACHE))
      .resolves.toBe('reset_initiated');
    await expect(finishGpaEnrichment(testEnv.DB, 'obsolete-generation'))
      .rejects.toThrow('refusing stale GPA publication');

    const state = await testEnv.DB.prepare(`
      SELECT last_status, cursor, owner_token FROM sync_state WHERE id = 'gpa'
    `).first<{ last_status: string; cursor: number; owner_token: string }>();
    expect(state).toEqual({
      last_status: 'pending',
      cursor: 0,
      owner_token: expect.not.stringContaining('obsolete-generation'),
    });
  });

  it('imports more than 1,000 source rows through one D1 statement', async () => {
    const lines = Array.from({ length: 1_200 }, (_, index) => gpaLine(String(100 + index)));
    const dataset = [
      GPA_HEADER,
      ...lines,
    ].join('\n');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(dataset, { status: 200 })));

    await expect(resumeGpaSync(testEnv.DB, testEnv.GPA_CACHE)).resolves.toMatchObject({
      success: true,
      rowsProcessed: 1_200,
      isComplete: true,
    });
    const count = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS count FROM gpa_source_rows WHERE subject = 'TEST'",
    ).first<{ count: number }>();
    expect(count?.count).toBe(1_200);
  });
});

function gpaLine(number: string): string {
  const columns = Array.from({ length: 23 }, () => '0');
  columns[0] = '2099';
  columns[1] = 'Test';
  columns[2] = '2099-test';
  columns[3] = 'TEST';
  columns[4] = number;
  columns[5] = 'Testing';
  columns[6] = 'Lecture';
  columns[8] = '10';
  columns[22] = '"Teacher, Ada"';
  return columns.join(',');
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}
