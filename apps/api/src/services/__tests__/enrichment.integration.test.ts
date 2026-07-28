import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { enrichCoursesWithScores } from '../enrichment.js';

const testEnv = env as unknown as { DB: D1Database };
const TERM_ID = '2098-score';

type PublishedScore = {
  id: string;
  quality_score: number | null;
  difficulty_score: number | null;
  primary_instructor_rmp: number | null;
};

describe('course score publication in D1', () => {
  beforeEach(async () => {
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        'DROP TRIGGER IF EXISTS score_publication_abort',
      ),
      testEnv.DB.prepare(
        'DELETE FROM instructor_course_links WHERE term_id = ?',
      ).bind(TERM_ID),
      testEnv.DB.prepare(
        "DELETE FROM courses WHERE subject = 'SCORE' AND year = 2098",
      ),
      testEnv.DB.prepare(`
        DELETE FROM rmp_cache
        WHERE rmp_id LIKE 'score-publication-%'
      `),
    ]);
  });

  it('atomically publishes exact evidence-gated scores and clears stale values', async () => {
    const now = Math.floor(Date.now() / 1000);
    await testEnv.DB.batch([
      testEnv.DB.prepare(`
        INSERT INTO rmp_cache (
          instructor_name, first_name, last_name, rmp_id,
          rating, difficulty, num_ratings, fetched_at, expires_at
        )
        VALUES
          ('Lovelace, Ada', 'Ada', 'Lovelace', 'score-publication-ada',
            4.5, 3, 20, ?, ?),
          ('Hopper, Grace', 'Grace', 'Hopper', 'score-publication-grace',
            1, 5, 1000, ?, ?),
          ('Person, Sparse', 'Sparse', 'Person', 'score-publication-sparse',
            5, 1, 4, ?, ?),
          ('Person, Expired', 'Expired', 'Person', 'score-publication-expired',
            5, 5, 100, ?, ?),
          ('Turing, Alan', 'Alan', 'Turing', 'score-publication-alan',
            3.5, 4, 10, ?, ?)
      `).bind(
        now, now + 3600,
        now, now + 3600,
        now, now + 3600,
        now, now - 1,
        now, now + 3600,
      ),
      testEnv.DB.prepare(`
        INSERT INTO courses (
          id, subject, number, title, year, term,
          avg_gpa, gpa_sample_size, primary_instructor,
          primary_instructor_rmp, quality_score, difficulty_score
        )
        VALUES
          ('SCORE-101-2098-score', 'SCORE', '101', 'Primary only',
            2098, 'score', 3.6, 100, 'Lovelace, Ada', 9, 9, 9),
          ('SCORE-102-2098-score', 'SCORE', '102', 'Insufficient GPA',
            2098, 'score', 3.6, 29, 'Lovelace, Ada', 9, 9, 9),
          ('SCORE-103-2098-score', 'SCORE', '103', 'Insufficient RMP',
            2098, 'score', 3.6, 100, 'Person, Sparse', 9, 9, 9),
          ('SCORE-104-2098-score', 'SCORE', '104', 'Expired RMP',
            2098, 'score', 3.6, 100, 'Person, Expired', 9, 9, 9),
          ('SCORE-105-2098-score', 'SCORE', '105', 'No linked evidence',
            2098, 'score', 3.6, 100, 'Person, Missing', 9, 9, 9),
          ('SCORE-107-2098-score', 'SCORE', '107', 'Multiple primaries',
            2098, 'score', 3, 100, 'Lovelace, Ada; Turing, Alan', 9, 9, 9)
      `),
      testEnv.DB.prepare(`
        INSERT INTO instructor_course_links (
          term_id, subject, number, instructor_name, rmp_id
        )
        VALUES
          (?, 'SCORE', '101', 'Lovelace, Ada', 'score-publication-ada'),
          (?, 'SCORE', '101', 'Hopper, Grace', 'score-publication-grace'),
          (?, 'SCORE', '102', 'Lovelace, Ada', 'score-publication-ada'),
          (?, 'SCORE', '103', 'Person, Sparse', 'score-publication-sparse'),
          (?, 'SCORE', '104', 'Person, Expired', 'score-publication-expired'),
          (?, 'SCORE', '107', 'Lovelace, Ada', 'score-publication-ada'),
          (?, 'SCORE', '107', 'Turing, Alan', 'score-publication-alan')
      `).bind(TERM_ID, TERM_ID, TERM_ID, TERM_ID, TERM_ID, TERM_ID, TERM_ID),
    ]);

    const courseCount = await testEnv.DB.prepare(
      'SELECT COUNT(*) AS count FROM courses',
    ).first<{ count: number }>();
    const result = await enrichCoursesWithScores(testEnv.DB);

    expect(result).toEqual({ updated: courseCount?.count ?? 0 });
    const published = await testEnv.DB.prepare(`
      SELECT
        id, quality_score, difficulty_score, primary_instructor_rmp
      FROM courses
      WHERE subject = 'SCORE' AND year = 2098
      ORDER BY number
    `).all<PublishedScore>();

    expect(published.results.slice(0, 5)).toEqual([
      {
        id: 'SCORE-101-2098-score',
        quality_score: 84.5,
        difficulty_score: 50,
        primary_instructor_rmp: 4.5,
      },
      {
        id: 'SCORE-102-2098-score',
        quality_score: null,
        difficulty_score: 50,
        primary_instructor_rmp: 4.5,
      },
      {
        id: 'SCORE-103-2098-score',
        quality_score: null,
        difficulty_score: null,
        primary_instructor_rmp: null,
      },
      {
        id: 'SCORE-104-2098-score',
        quality_score: null,
        difficulty_score: null,
        primary_instructor_rmp: null,
      },
      {
        id: 'SCORE-105-2098-score',
        quality_score: null,
        difficulty_score: null,
        primary_instructor_rmp: null,
      },
    ]);
    expect(published.results[5]).toMatchObject({
      id: 'SCORE-107-2098-score',
      quality_score: 67.5,
      difficulty_score: 58.3,
    });
    expect(published.results[5]?.primary_instructor_rmp).toBeCloseTo(
      4.1667,
      4,
    );

    await testEnv.DB.prepare(`
      UPDATE courses
      SET
        quality_score = 9,
        difficulty_score = 9,
        primary_instructor_rmp = 9
      WHERE subject = 'SCORE' AND year = 2098
    `).run();
    await testEnv.DB.prepare(`
      CREATE TRIGGER score_publication_abort
      BEFORE UPDATE OF quality_score ON courses
      WHEN OLD.id = 'SCORE-104-2098-score'
      BEGIN
        SELECT RAISE(ABORT, 'forced score publication failure');
      END
    `).run();

    await expect(enrichCoursesWithScores(testEnv.DB)).rejects.toThrow(
      'forced score publication failure',
    );
    const afterFailure = await testEnv.DB.prepare(`
      SELECT
        COUNT(*) AS course_count,
        SUM(
          CASE
            WHEN quality_score = 9
              AND difficulty_score = 9
              AND primary_instructor_rmp = 9
            THEN 1
            ELSE 0
          END
        ) AS unchanged_count
      FROM courses
      WHERE subject = 'SCORE' AND year = 2098
    `).first<{ course_count: number; unchanged_count: number }>();
    expect(afterFailure).toEqual({
      course_count: 6,
      unchanged_count: 6,
    });

    await testEnv.DB.prepare(
      'DROP TRIGGER score_publication_abort',
    ).run();
  });
});
