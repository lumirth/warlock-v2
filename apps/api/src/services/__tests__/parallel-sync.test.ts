import { describe, expect, it, vi } from 'vitest';
import { syncSubjects } from '../parallel-sync.js';
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

});
