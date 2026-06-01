import { describe, expect, it, vi } from 'vitest';
import { calculateCourseScores, coordinateEnrichment, enrichCoursesWithScores } from '../enrichment.js';
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

describe('course score enrichment', () => {
  it('normalizes GPA and RMP data into 0-100 quality and difficulty scores', () => {
    expect(calculateCourseScores({
      id: 'CS-225-2026-spring',
      avg_gpa: 3.6,
      primary_instructor_rmp: 4.5,
      linked_rmp_rating: 4.2,
      linked_rmp_difficulty: 3,
    })).toEqual({
      qualityScore: 90,
      difficultyScore: 35,
      primaryInstructorRmp: 4.5,
    });
  });

  it('falls back to linked RMP rating when the course primary rating is empty', () => {
    expect(calculateCourseScores({
      id: 'CS-173-2026-spring',
      avg_gpa: null,
      primary_instructor_rmp: null,
      linked_rmp_rating: 4,
      linked_rmp_difficulty: 2.5,
    })).toEqual({
      qualityScore: 80,
      difficultyScore: 50,
      primaryInstructorRmp: 4,
    });
  });

  it('updates courses from aggregate GPA and linked RMP data', async () => {
    const updateBinds: unknown[][] = [];
    const db = {
      prepare: vi.fn((sql: string) => ({
        all: vi.fn(async () => ({
          success: true,
          results: [{
            id: 'CS-225-2026-spring',
            avg_gpa: 3.6,
            primary_instructor_rmp: null,
            linked_rmp_rating: 4.5,
            linked_rmp_difficulty: 3,
          }],
        })),
        bind: vi.fn((...args: unknown[]) => {
          if (sql.includes('UPDATE courses')) {
            updateBinds.push(args);
          }
          return {};
        }),
      })),
      batch: vi.fn(async () => []),
    };

    const result = await enrichCoursesWithScores(db as unknown as D1Database);

    expect(result).toEqual({ updated: 1 });
    expect(updateBinds).toEqual([
      [90, 35, 4.5, 'CS-225-2026-spring'],
    ]);
    expect(db.batch).toHaveBeenCalledTimes(1);
  });
});
