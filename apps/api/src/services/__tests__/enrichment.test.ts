import { describe, expect, it, vi } from 'vitest';
import { calculateCourseScores, coordinateEnrichment, enrichCoursesWithScores } from '../enrichment.js';
import type { D1Database, Fetcher } from '@cloudflare/workers-types';

function createSetBasedDb() {
  const stateWrites: unknown[][] = [];
  const linkRebuildBinds: unknown[][] = [];
  const updateBinds: unknown[][] = [];

  const db = {
    prepare: vi.fn((sql: string) => ({
      first: vi.fn(async () => {
        return null;
      }),
      all: vi.fn(async () => {
        if (sql.includes('FROM term_state')) {
          return {
            success: true,
            results: [
              { term_id: '2026-fall', year: 2026, term: 'fall' },
              { term_id: '2026-summer', year: 2026, term: 'summer' },
            ],
          };
        }
        if (sql.includes('FROM courses c')) {
          return {
            success: true,
            results: [{
              id: 'CS-225-2026-spring',
              avg_gpa: 3.6,
              primary_instructor_rmp: null,
              linked_rmp_rating: 4.5,
              linked_rmp_difficulty: 3,
            }],
          };
        }
        return { success: true, results: [] };
      }),
      bind: vi.fn((...args: unknown[]) => {
        if (sql.includes('UPDATE courses')) {
          updateBinds.push(args);
          return {};
        }
        return {
          first: vi.fn(async () => {
            if (sql.includes('context_count')) {
              return { context_count: 7734 };
            }
            return null;
          }),
          run: vi.fn(async () => {
            if (sql.includes('INSERT INTO sync_state')) {
              stateWrites.push(args);
              return {};
            }
            if (sql.includes('INSERT INTO instructor_course_links')) {
              linkRebuildBinds.push(args);
              return { meta: { changes: 7734 } };
            }
            return {};
          }),
          all: vi.fn(async () => ({ success: true, results: [] })),
        };
      }),
    })),
    batch: vi.fn(async () => []),
  };

  return { db, stateWrites, linkRebuildBinds, updateBinds };
}

describe('coordinateEnrichment', () => {
  it('rebuilds every registrable or active term in set-based passes and recomputes scores once', async () => {
    const { db, stateWrites, linkRebuildBinds, updateBinds } = createSetBasedDb();
    const selfBinding: { fetch: ReturnType<typeof vi.fn> } = {
      fetch: vi.fn(),
    };

    const result = await coordinateEnrichment(
      db as unknown as D1Database,
      selfBinding as unknown as Fetcher,
      'internal-token'
    );

    expect(result).toEqual({
      taskCount: 15468,
      batchCount: 2,
      linkCount: 15468,
      scoreUpdateCount: 1,
    });
    expect(selfBinding.fetch).not.toHaveBeenCalled();
    expect(linkRebuildBinds).toEqual([
      ['2026-fall', 2026, 'fall'],
      ['2026-summer', 2026, 'summer'],
    ]);
    expect(updateBinds).toEqual([[85.3, 25, 4.5, 'CS-225-2026-spring']]);
    expect(stateWrites).toEqual([
      ['enrichment:2026-fall', 'running', 0, 1, '2026-fall'],
      ['enrichment:2026-fall', 'complete', 7734, 1, '2026-fall'],
      ['enrichment:2026-summer', 'running', 0, 1, '2026-summer'],
      ['enrichment:2026-summer', 'complete', 7734, 1, '2026-summer'],
    ]);
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
      qualityScore: 80,
      difficultyScore: 25,
      primaryInstructorRmp: 4.2,
    });
  });

  it('does not classify a 2.82 GPA course as easy from GPA-only difficulty evidence', () => {
    const result = calculateCourseScores({
      id: 'CS-374-2026-spring',
      avg_gpa: 2.82,
      primary_instructor_rmp: null,
      linked_rmp_rating: null,
      linked_rmp_difficulty: null,
    });

    expect(result.difficultyScore).toBeGreaterThanOrEqual(75);
  });

  it('ignores zero-valued RMP metrics as missing evidence', () => {
    expect(calculateCourseScores({
      id: 'CS-374-2026-spring',
      avg_gpa: 2.82,
      primary_instructor_rmp: 0,
      linked_rmp_rating: 0,
      linked_rmp_difficulty: 0,
    })).toEqual({
      qualityScore: 41,
      difficultyScore: 85,
      primaryInstructorRmp: null,
    });
  });

  it('classifies CS 374 as hard when valid linked RMP difficulty is present', () => {
    const result = calculateCourseScores({
      id: 'CS-374-2026-spring',
      avg_gpa: 2.82,
      primary_instructor_rmp: null,
      linked_rmp_rating: 3,
      linked_rmp_difficulty: 3.8,
    });

    expect(result.qualityScore).toBe(47.3);
    expect(result.difficultyScore).toBeGreaterThan(75);
  });

  it('falls back to linked RMP rating when the course primary rating is empty', () => {
    expect(calculateCourseScores({
      id: 'CS-173-2026-spring',
      avg_gpa: null,
      primary_instructor_rmp: null,
      linked_rmp_rating: 4,
      linked_rmp_difficulty: 2.5,
    })).toEqual({
      qualityScore: 75,
      difficultyScore: 37.5,
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
      [85.3, 25, 4.5, 'CS-225-2026-spring'],
    ]);
    expect(db.batch).toHaveBeenCalledTimes(1);
  });
});
