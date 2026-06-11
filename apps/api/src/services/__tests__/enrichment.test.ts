import { describe, expect, it, vi } from 'vitest';
import { calculateCourseScores, coordinateEnrichment, enrichCoursesWithGpa, enrichCoursesWithScores } from '../enrichment.js';
import type { D1Database } from '@cloudflare/workers-types';

function createSetBasedDb(options: { failScoreUpdate?: boolean } = {}) {
  const stateWrites: unknown[][] = [];
  const linkRebuildBinds: unknown[][] = [];
  const linkDeleteBinds: unknown[][] = [];
  const updateBinds: unknown[][] = [];
  const preparedSql: string[] = [];

  const db = {
    prepare: vi.fn((sql: string) => {
      preparedSql.push(sql);
      return {
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
            if (sql.includes('DELETE FROM instructor_course_links')) {
              linkDeleteBinds.push(args);
              return { meta: { changes: 12 } };
            }
            return {};
          }),
          all: vi.fn(async () => ({ success: true, results: [] })),
        };
      }),
    };
    }),
    batch: vi.fn(async () => {
      if (options.failScoreUpdate) throw new Error('score update failed');
      return [];
    }),
  };

  return { db, stateWrites, linkRebuildBinds, linkDeleteBinds, updateBinds, preparedSql };
}

describe('coordinateEnrichment', () => {
  it('rebuilds every registrable or active term in set-based passes and recomputes scores once', async () => {
    const { db, stateWrites, linkRebuildBinds, linkDeleteBinds, updateBinds, preparedSql } = createSetBasedDb();
    const result = await coordinateEnrichment(db as unknown as D1Database);

    expect(result).toEqual({
      taskCount: 15468,
      batchCount: 2,
      linkCount: 15468,
      scoreUpdateCount: 1,
    });
    expect(linkRebuildBinds).toEqual([
      ['2026-fall', 2026, 'fall'],
      ['2026-summer', 2026, 'summer'],
    ]);
    expect(linkDeleteBinds).toEqual([
      ['2026-fall'],
      ['2026-summer'],
    ]);
    expect(preparedSql.some(sql => sql.includes('JOIN meeting_instructors'))).toBe(true);
    expect(preparedSql.some(sql => sql.includes('WITH RECURSIVE split'))).toBe(false);
    expect(preparedSql.some(sql => sql.includes('confidence_score') || sql.includes('match_method'))).toBe(false);
    expect(updateBinds).toEqual([[85.3, 25, 4.5, 'CS-225-2026-spring']]);
    expect(stateWrites).toEqual([
      ['enrichment', expect.any(Number), 'running', 0, null, null],
      ['enrichment', expect.any(Number), 'complete', 15468, null, null],
    ]);
  });

  it('marks the whole workflow failed when score enrichment fails', async () => {
    const { db, stateWrites } = createSetBasedDb({ failScoreUpdate: true });

    await expect(coordinateEnrichment(db as unknown as D1Database))
      .rejects.toThrow('score update failed');

    expect(stateWrites).toEqual([
      ['enrichment', expect.any(Number), 'running', 0, null, null],
      ['enrichment', expect.any(Number), 'failed', 15468, null, null],
    ]);
  });
});

describe('course score enrichment', () => {
  it('rebuilds course-average GPA rows instead of relying on NULL conflict keys', async () => {
    const executedSql: string[] = [];
    const db = {
      prepare: vi.fn((sql: string) => ({
        run: vi.fn(async () => {
          executedSql.push(sql);
          return {};
        }),
        all: vi.fn(async () => ({ success: true, results: [] })),
      })),
      batch: vi.fn(async () => []),
    };

    await enrichCoursesWithGpa(db as unknown as D1Database);

    expect(executedSql[0]).toContain('DELETE FROM gpa_stats');
    expect(executedSql[0]).toContain('instructor IS NULL');
    expect(executedSql[1]).toContain('INSERT INTO gpa_stats');
    expect(executedSql[1]).not.toContain('ON CONFLICT(subject, number, instructor)');
  });

  it('surfaces course-average rebuild failures instead of reporting partial enrichment', async () => {
    const db = {
      prepare: vi.fn(() => ({
        run: vi.fn(async () => {
          throw new Error('aggregate rebuild failed');
        }),
      })),
    };

    await expect(enrichCoursesWithGpa(db as unknown as D1Database))
      .rejects.toThrow('aggregate rebuild failed');
  });

  it('surfaces aggregate lookup failures instead of reporting partial enrichment', async () => {
    let prepareCount = 0;
    const db = {
      prepare: vi.fn(() => {
        prepareCount += 1;
        return {
          run: vi.fn(async () => ({})),
          all: vi.fn(async () => ({ success: false, results: [] })),
        };
      }),
    };

    await expect(enrichCoursesWithGpa(db as unknown as D1Database))
      .rejects.toThrow('Failed to load aggregate GPA updates');
    expect(prepareCount).toBe(3);
  });

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

  it('surfaces score-source lookup failures instead of reporting zero updates', async () => {
    const db = {
      prepare: vi.fn(() => ({
        all: vi.fn(async () => ({ success: false, results: [] })),
      })),
    };

    await expect(enrichCoursesWithScores(db as unknown as D1Database))
      .rejects.toThrow('Failed to load course score sources');
  });
});
