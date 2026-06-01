import { describe, expect, it, vi } from 'vitest';
import { syncSubjects } from '../parallel-sync.js';

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
      db as any,
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
});
