import { describe, expect, it, vi } from 'vitest';
import { calculateCourseScores, coordinateEnrichment, enrichCoursesWithGpa, enrichCoursesWithScores } from '../enrichment.js';
import type { D1Database } from '@cloudflare/workers-types';

function createSetBasedDb(options: { failScoreUpdate?: boolean } = {}) {
  const stateWrites: unknown[][] = [];
  const linkRebuildBinds: unknown[][] = [];
  const linkDeleteBinds: unknown[][] = [];
  const preparedSql: string[] = [];
  const transactionalBatches: string[][] = [];

  const db = {
    prepare: vi.fn((sql: string) => {
      preparedSql.push(sql);
      return {
      sql,
      first: vi.fn(async () => {
        return null;
      }),
      run: vi.fn(async () => {
        if (sql.includes('WITH score_sources AS')) {
          if (options.failScoreUpdate) {
            throw new Error('score update failed');
          }
          return { meta: { changes: 1 } };
        }
        return { meta: { changes: 0 } };
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
              gpa_sample_size: 100,
              primary_instructor_rmp: null,
              linked_rmp_rating: 4.5,
              linked_rmp_difficulty: 3,
              linked_rmp_num_ratings: 20,
            }],
          };
        }
        return { success: true, results: [] };
      }),
      bind: vi.fn((...args: unknown[]) => {
        if (sql.includes('INSERT INTO instructor_course_links')) {
          linkRebuildBinds.push(args);
        }
        if (sql.includes('DELETE FROM instructor_course_links')) {
          linkDeleteBinds.push(args);
        }
        return {
          sql,
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
              return { meta: { changes: 7734 } };
            }
            if (sql.includes('DELETE FROM instructor_course_links')) {
              return { meta: { changes: 12 } };
            }
            return {};
          }),
          all: vi.fn(async () => ({ success: true, results: [] })),
        };
      }),
    };
    }),
    batch: vi.fn(async (statements: Array<{ sql?: string; run?: () => Promise<unknown> }>) => {
      const sql = statements.map(statement => statement.sql ?? '');
      transactionalBatches.push(sql);
      if (sql.some(statement => statement.includes('WITH score_sources AS'))) {
        if (options.failScoreUpdate) {
          throw new Error('score update failed');
        }
        return [
          { meta: { changes: 1 } },
          { results: [{ updated: 1 }] },
        ];
      }
      const results = [];
      for (const statement of statements) {
        results.push(statement.run ? await statement.run() : {});
      }
      return results;
    }),
  };

  return {
    db,
    stateWrites,
    linkRebuildBinds,
    linkDeleteBinds,
    preparedSql,
    transactionalBatches,
  };
}

describe('coordinateEnrichment', () => {
  it('rebuilds every registrable or active term in set-based passes and recomputes scores once', async () => {
    const {
      db,
      stateWrites,
      linkRebuildBinds,
      linkDeleteBinds,
      preparedSql,
      transactionalBatches,
    } = createSetBasedDb();
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
    expect(preparedSql.filter(sql => sql.includes('WITH score_sources AS'))).toHaveLength(1);
    expect(transactionalBatches.slice(0, 2).map(batch =>
      batch.map(sql => sql.replace(/\s+/g, ' ').trim())
    )).toEqual([
      [
        'DELETE FROM instructor_course_links WHERE term_id = ?',
        expect.stringContaining('INSERT INTO instructor_course_links'),
      ],
      [
        'DELETE FROM instructor_course_links WHERE term_id = ?',
        expect.stringContaining('INSERT INTO instructor_course_links'),
      ],
    ]);
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
  it('uses only canonical primary instructors and applies rating floors per profile', async () => {
    const preparedSql: string[] = [];
    const db = {
      prepare: vi.fn((sql: string) => {
        preparedSql.push(sql);
        return {
          run: vi.fn(async () => ({ meta: { changes: 0 } })),
        };
      }),
      batch: vi.fn(async () => [
        { meta: { changes: 0 } },
        { results: [{ updated: 0 }] },
      ]),
    };

    await enrichCoursesWithScores(db as unknown as D1Database);

    const sourceSql = preparedSql[0];
    expect(sourceSql).toContain("COALESCE(c.primary_instructor, '')");
    expect(sourceSql).toContain("';' || trim(l.instructor_name) || ';'");
    expect(sourceSql).toContain('COALESCE(r.num_ratings, 0) >= 5');
    expect(sourceSql).not.toContain('COALESCE(r.num_ratings, 0) > 0');
  });

  it('rebuilds course-average GPA rows instead of relying on NULL conflict keys', async () => {
    const executedSql: string[] = [];
    const batchSql: string[][] = [];
    const db = {
      prepare: vi.fn((sql: string) => ({
        sql,
        run: vi.fn(async () => {
          executedSql.push(sql);
          return {};
        }),
      })),
      batch: vi.fn(async (statements: Array<{ sql: string }>) => {
        batchSql.push(statements.map(statement => statement.sql));
        return [];
      }),
    };

    await enrichCoursesWithGpa(db as unknown as D1Database);

    expect(batchSql).toHaveLength(1);
    expect(batchSql[0][0]).toContain('DELETE FROM gpa_stats');
    expect(batchSql[0][0]).toContain('instructor IS NULL');
    expect(batchSql[0][1]).toContain('INSERT INTO gpa_stats');
    expect(batchSql[0][1]).not.toContain('ON CONFLICT(subject, number, instructor)');
    expect(executedSql).toHaveLength(1);
    expect(executedSql[0]).toContain('UPDATE courses');
    expect(executedSql[0]).not.toContain('SET avg_gpa = NULL');
  });

  it('does not start public GPA publication when aggregate replacement fails', async () => {
    const publish = vi.fn();
    const db = {
      prepare: vi.fn((sql: string) => ({
        sql,
        run: publish,
      })),
      batch: vi.fn(async () => {
        throw new Error('aggregate rebuild failed');
      }),
    };

    await expect(enrichCoursesWithGpa(db as unknown as D1Database))
      .rejects.toThrow('aggregate rebuild failed');
    expect(publish).not.toHaveBeenCalled();
  });

  it('publishes course GPA values in one atomic statement without a prior blanking pass', async () => {
    const executedSql: string[] = [];
    const db = {
      prepare: vi.fn((sql: string) => ({
        sql,
        run: vi.fn(async () => {
          executedSql.push(sql);
          throw new Error('public GPA publication failed');
        }),
      })),
      batch: vi.fn(async () => []),
    };

    await expect(enrichCoursesWithGpa(db as unknown as D1Database))
      .rejects.toThrow('public GPA publication failed');
    expect(executedSql).toHaveLength(1);
    expect(executedSql[0]).toContain('UPDATE courses');
    expect(executedSql[0]).not.toContain('SET avg_gpa = NULL');
  });

  it('normalizes GPA and RMP data into 0-100 quality and difficulty scores', () => {
    expect(calculateCourseScores({
      id: 'CS-225-2026-spring',
      avg_gpa: 3.6,
      gpa_sample_size: 100,
      primary_instructor_rmp: 4.5,
      linked_rmp_rating: 4.2,
      linked_rmp_difficulty: 3,
      linked_rmp_num_ratings: 20,
    })).toEqual({
      qualityScore: 80,
      difficultyScore: 50,
      primaryInstructorRmp: 4.2,
    });
  });

  it('does not classify a 2.82 GPA course as easy from GPA-only difficulty evidence', () => {
    const result = calculateCourseScores({
      id: 'CS-374-2026-spring',
      avg_gpa: 2.82,
      gpa_sample_size: 100,
      primary_instructor_rmp: null,
      linked_rmp_rating: null,
      linked_rmp_difficulty: null,
    });

    expect(result).toEqual({
      qualityScore: null,
      difficultyScore: null,
      primaryInstructorRmp: null,
    });
  });

  it('ignores zero-valued RMP metrics as missing evidence', () => {
    expect(calculateCourseScores({
      id: 'CS-374-2026-spring',
      avg_gpa: 2.82,
      gpa_sample_size: 100,
      primary_instructor_rmp: 0,
      linked_rmp_rating: 0,
      linked_rmp_difficulty: 0,
      linked_rmp_num_ratings: 20,
    })).toEqual({
      qualityScore: null,
      difficultyScore: null,
      primaryInstructorRmp: null,
    });
  });

  it('classifies CS 374 as hard when valid linked RMP difficulty is present', () => {
    const result = calculateCourseScores({
      id: 'CS-374-2026-spring',
      avg_gpa: 2.82,
      gpa_sample_size: 100,
      primary_instructor_rmp: null,
      linked_rmp_rating: 3,
      linked_rmp_difficulty: 3.8,
      linked_rmp_num_ratings: 20,
    });

    expect(result.qualityScore).toBe(46.4);
    expect(result.difficultyScore).toBe(70);
  });

  it('falls back to linked RMP rating when the course primary rating is empty', () => {
    expect(calculateCourseScores({
      id: 'CS-173-2026-spring',
      avg_gpa: null,
      primary_instructor_rmp: null,
      linked_rmp_rating: 4,
      linked_rmp_difficulty: 2.5,
      linked_rmp_num_ratings: 20,
    })).toEqual({
      qualityScore: null,
      difficultyScore: 37.5,
      primaryInstructorRmp: 4,
    });
  });

  it('computes and publishes all course scores in one bounded D1 statement', async () => {
    const preparedSql: string[] = [];
    const batch = vi.fn(async (_statements: unknown[]) => [
      { meta: { changes: 248_265 } },
      { results: [{ updated: 49_653 }] },
    ]);
    const db = {
      prepare: vi.fn((sql: string) => {
        preparedSql.push(sql);
        return { sql };
      }),
      batch,
    };

    const result = await enrichCoursesWithScores(db as unknown as D1Database);

    expect(result).toEqual({ updated: 49_653 });
    expect(db.prepare).toHaveBeenCalledTimes(2);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0]?.[0]).toHaveLength(2);
    expect(preparedSql[0]).toContain('WITH score_sources AS');
    expect(preparedSql[0]).toContain('UPDATE courses AS target');
    expect(preparedSql[0]).not.toContain('json_each');
    expect(preparedSql[1]).toContain('SELECT COUNT(*) AS updated');
  });

  it('surfaces atomic publication failures', async () => {
    const db = {
      prepare: vi.fn((sql: string) => ({ sql })),
      batch: vi.fn(async () => {
        throw new Error('score publication failed');
      }),
    };

    await expect(enrichCoursesWithScores(db as unknown as D1Database))
      .rejects.toThrow('score publication failed');
  });

  it('uses an atomic set-based publication with no pre-blanking or client-side staging', async () => {
    const preparedSql: string[] = [];
    const db = {
      prepare: vi.fn((sql: string) => {
        preparedSql.push(sql);
        return { sql };
      }),
      batch: vi.fn(async () => [
        { meta: { changes: 0 } },
        { results: [{ updated: 0 }] },
      ]),
    };

    await enrichCoursesWithScores(db as unknown as D1Database);

    expect(preparedSql).toHaveLength(2);
    expect(preparedSql[0]).toContain('ELSE NULL');
    expect(preparedSql[0]).toContain('r.expires_at > unixepoch()');
    expect(preparedSql[0]).not.toContain('json_extract');
    expect(preparedSql[0]).not.toContain('json_each');
  });
});
