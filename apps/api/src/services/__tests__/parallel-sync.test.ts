import { describe, expect, it, vi } from 'vitest';
import { pruneStaleCourseGeneds, pruneStaleSubjectRows, syncSubjects } from '../parallel-sync.js';
import { browserFetch } from '../../http/browser-fetch.js';
import type { D1Database } from '@cloudflare/workers-types';

vi.mock('../../http/browser-fetch.js', () => ({
  browserFetch: vi.fn(),
}));

describe('syncSubjects', () => {
  it('skips a subject when a fresh running sync lock already exists', async () => {
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () => sql.includes('SELECT last_sync')
            ? { last_sync: Math.floor(Date.now() / 1000), last_status: 'running' }
            : null),
          run: vi.fn(async () => ({})),
        })),
      })),
    };

    const result = await syncSubjects(
      db as unknown as D1Database,
      { cisapiBase: 'https://example.invalid', concurrency: 1 },
      2026,
      'spring',
      ['CS']
    );

    expect(result.subjectResults).toEqual([
      expect.objectContaining({
        subject: 'CS',
        success: true,
        skipped: true,
        coursesCount: 0,
        sectionsCount: 0,
      }),
    ]);
    expect(db.prepare).toHaveBeenCalledTimes(1);
  });

  it('force-refreshes a subject even when a fresh running sync lock exists', async () => {
    vi.mocked(browserFetch).mockResolvedValueOnce(new Response('', { status: 404 }));
    const writes: unknown[][] = [];
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn((...args: unknown[]) => ({
          first: vi.fn(async () => sql.includes('SELECT last_sync')
            ? { last_sync: Math.floor(Date.now() / 1000), last_status: 'running' }
            : null),
          run: vi.fn(async () => {
            writes.push([sql.replace(/\s+/g, ' ').trim(), ...args]);
            return {};
          }),
        })),
      })),
    };

    const result = await syncSubjects(
      db as unknown as D1Database,
      { cisapiBase: 'https://example.invalid', concurrency: 1 },
      2026,
      'spring',
      ['CS'],
      undefined,
      undefined,
      { lockMode: 'force' }
    );

    expect(result.subjectResults).toEqual([
      expect.objectContaining({
        subject: 'CS',
        success: false,
        error: 'HTTP 404 for CS',
      }),
    ]);
    expect(result.subjectResults[0]).not.toHaveProperty('skipped');
    expect(writes.some(write => String(write[0]).includes('INSERT INTO sync_state'))).toBe(true);
  });

  it('prunes stale sections, meetings, geneds, and courses for a successfully refreshed subject', async () => {
    const calls: unknown[][] = [];
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn((...args: unknown[]) => ({
          run: vi.fn(async () => {
            calls.push([sql.replace(/\s+/g, ' ').trim(), ...args]);
            return {};
          }),
        })),
      })),
    };

    await pruneStaleSubjectRows(db as unknown as D1Database, 'CS', 2026, 'spring', 123456);

    expect(calls).toHaveLength(5);
    for (const call of calls) {
      expect(call.slice(1)).toEqual(['CS', 2026, 'spring', 123456]);
    }
    expect(calls[0][0]).toContain('DELETE FROM meeting_instructors');
    expect(calls[1][0]).toContain('DELETE FROM meetings');
    expect(calls[2][0]).toContain('DELETE FROM sections');
    expect(calls[3][0]).toContain('DELETE FROM course_gened');
    expect(calls[4][0]).toContain('DELETE FROM courses');
  });

  it('removes stale GenEd rows while preserving the current category/attribute keys', async () => {
    const bindCalls: unknown[][] = [];
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn((...args: unknown[]) => {
          bindCalls.push(args);
          return { run: vi.fn(async () => ({})) };
        }),
      })),
    };

    await pruneStaleCourseGeneds(db as unknown as D1Database, {
      courseId: 'CS-225-2026-spring',
      currentKeys: [
        { categoryId: 'QR', attributeCode: '1QR2' },
        { categoryId: 'ACP', attributeCode: null },
      ],
    });

    expect(bindCalls).toEqual([
      ['CS-225-2026-spring', 'QR', '1QR2', 'ACP', ''],
    ]);
  });
});
