import { describe, expect, it, vi } from 'vitest';
import { coordinateEnrichment } from '../enrichment.js';
import type { D1Database, Fetcher } from '@cloudflare/workers-types';

function createDb(overrides: {
  courses?: Array<{ subject: string; number: string; primary_instructor: string }>;
  existingLinks?: Array<{ term_id: string; subject: string; number: string; instructor_name: string }>;
} = {}) {
  const stateWrites: unknown[][] = [];
  const courses = overrides.courses ?? [
    { subject: 'CS', number: '225', primary_instructor: 'Zed, Z; Ada, A' },
    { subject: 'CS', number: '101', primary_instructor: 'Grace, G' },
  ];
  const existingLinks = overrides.existingLinks ?? [
    { term_id: '2026-spring', subject: 'CS', number: '101', instructor_name: 'Grace, G' },
  ];

  const db = {
    prepare: vi.fn((sql: string) => ({
      first: vi.fn(async () => {
        if (sql.includes('FROM term_state')) {
          return { term_id: '2026-spring', year: 2026, term: 'spring' };
        }
        return null;
      }),
      bind: vi.fn((...args: unknown[]) => ({
        first: vi.fn(async () => {
          if (sql.includes('FROM term_state')) {
            return { term_id: '2026-spring', year: 2026, term: 'spring' };
          }
          return null;
        }),
        all: vi.fn(async () => {
          if (sql.includes('FROM courses')) {
            return { success: true, results: courses };
          }
          if (sql.includes('FROM instructor_course_links')) {
            return {
              success: true,
              results: existingLinks,
            };
          }
          return { success: true, results: [] };
        }),
        run: vi.fn(async () => {
          stateWrites.push(args);
          return {};
        }),
      })),
    })),
  };

  return { db, stateWrites };
}

describe('coordinateEnrichment', () => {
  it('dispatches missing instructor contexts in deterministic order and records progress', async () => {
    const { db, stateWrites } = createDb();
    const selfBinding: { fetch: ReturnType<typeof vi.fn> } = {
      fetch: vi.fn(async () => new Response(null, { status: 202 })),
    };

    const result = await coordinateEnrichment(
      db as unknown as D1Database,
      selfBinding as unknown as Fetcher,
      'internal-token'
    );

    expect(result).toEqual({ taskCount: 2, batchCount: 1 });
    const request = selfBinding.fetch.mock.calls[0]?.[1] as RequestInit;
    expect(request).toBeDefined();
    const body = JSON.parse(String(request.body));
    expect(body.tasks).toEqual([
      { termId: '2026-spring', subject: 'CS', number: '225', instructorName: 'Ada, A' },
      { termId: '2026-spring', subject: 'CS', number: '225', instructorName: 'Zed, Z' },
    ]);
    expect(request.headers).toMatchObject({ Authorization: 'Bearer internal-token' });
    expect(stateWrites[0]).toEqual(['enrichment:2026-spring', 'running', 0, 1, '2026-spring']);
    expect(stateWrites.at(-1)).toEqual(['enrichment:2026-spring', 'complete', 2, 1, '2026-spring']);
  });

  it('limits each coordinator run to forty enrichment batches and records partial progress', async () => {
    const courses = Array.from({ length: 405 }, (_, index) => ({
      subject: 'CS',
      number: String(1000 + index),
      primary_instructor: `Instructor, ${index}`,
    }));
    const { db, stateWrites } = createDb({ courses, existingLinks: [] });
    const selfBinding: { fetch: ReturnType<typeof vi.fn> } = {
      fetch: vi.fn(async () => new Response(null, { status: 202 })),
    };

    const result = await coordinateEnrichment(
      db as unknown as D1Database,
      selfBinding as unknown as Fetcher,
      'internal-token'
    );

    expect(result).toEqual({ taskCount: 400, batchCount: 40 });
    expect(selfBinding.fetch).toHaveBeenCalledTimes(40);
    expect(stateWrites[0]).toEqual(['enrichment:2026-spring', 'running', 0, 40, '2026-spring']);
    expect(stateWrites.at(-1)).toEqual(['enrichment:2026-spring', 'partial', 400, 40, '2026-spring']);
  });
});
