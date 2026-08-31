import type { D1Database } from '@cloudflare/workers-types';
import {
  COURSE_SCORE_POLICY,
} from './course-score-policy.js';

const INSTRUCTOR_COURSE_CONTEXTS_SQL = `
  SELECT DISTINCT
    ? AS term_id,
    c.subject,
    c.number,
    i.display_name AS instructor_name
  FROM courses c
  JOIN sections s ON s.course_id = c.id
  JOIN meetings m ON m.section_id = s.id
  JOIN meeting_instructors mi ON mi.meeting_id = m.id
  JOIN instructors i ON i.id = mi.instructor_id
  WHERE c.year = ? AND c.term = ?
`;

export async function coordinateEnrichment(
  db: D1Database
): Promise<{ taskCount: number; batchCount: number; linkCount: number; scoreUpdateCount: number }> {
  let linkCount = 0;
  const terms = await db.prepare(`
    SELECT term_id, year, term FROM term_state
    WHERE status IN ('registrable', 'active')
    ORDER BY year DESC, CASE term
      WHEN 'fall' THEN 4 WHEN 'summer' THEN 3 WHEN 'spring' THEN 2 ELSE 1 END DESC
  `).all<{ term_id: string; year: number; term: string }>();
  for (const term of terms.results) {
    linkCount += (await rebuildInstructorCourseLinks(db, {
      termId: term.term_id, year: term.year, term: term.term,
    })).linkCount;
  }
  const scores = await enrichCoursesWithScores(db);
  return {
    taskCount: linkCount,
    batchCount: terms.results.length,
    linkCount,
    scoreUpdateCount: scores.updated,
  };
}

export async function rebuildInstructorCourseLinks(
  db: D1Database,
  options: { termId: string; year: number; term: string }
): Promise<{ contextCount: number; linkCount: number }> {
  const deleteStatement = db.prepare(`
    DELETE FROM instructor_course_links
    WHERE term_id = ?
  `).bind(options.termId);

  const insertStatement = db.prepare(`
    WITH contexts AS (${INSTRUCTOR_COURSE_CONTEXTS_SQL}),
    context_keys AS (
      SELECT
        c.*,
        lower(trim(c.instructor_name)) AS canonical_name,
        lower(trim(substr(
          c.instructor_name,
          1,
          instr(c.instructor_name, ',') - 1
        ))) AS last_name_key,
        lower(substr(trim(substr(
          c.instructor_name,
          instr(c.instructor_name, ',') + 1
        )), 1, 1)) AS first_initial
      FROM contexts c
    ),
    exact_rmp_matches AS (
      SELECT
        lower(trim(r.instructor_name)) AS canonical_name,
        min(r.rmp_id) AS rmp_id
      FROM rmp_cache r
      WHERE r.expires_at > unixepoch()
        AND trim(r.instructor_name) <> ''
      GROUP BY lower(trim(r.instructor_name))
      HAVING count(*) = 1
    ),
    initial_rmp_matches AS (
      SELECT
        lower(trim(r.last_name)) AS last_name_key,
        lower(substr(trim(r.first_name), 1, 1)) AS first_initial,
        min(r.rmp_id) AS rmp_id
      FROM rmp_cache r
      WHERE r.expires_at > unixepoch()
        AND trim(r.last_name) <> ''
        AND trim(r.first_name) <> ''
      GROUP BY
        lower(trim(r.last_name)),
        lower(substr(trim(r.first_name), 1, 1))
      HAVING count(*) = 1
    ),
    resolved AS (
      SELECT
        c.term_id,
        c.subject,
        c.number,
        c.instructor_name,
        (
          SELECT g.id
          FROM gpa_stats g
          WHERE g.subject = c.subject
            AND g.number = c.number
            AND lower(trim(g.instructor)) = lower(trim(c.instructor_name))
          ORDER BY g.sample_size DESC
          LIMIT 1
        ) AS gpa_id,
        coalesce(exact.rmp_id, initial.rmp_id) AS rmp_id
      FROM context_keys c
      LEFT JOIN exact_rmp_matches exact
        ON exact.canonical_name = c.canonical_name
      LEFT JOIN initial_rmp_matches initial
        ON exact.rmp_id IS NULL
        AND instr(c.instructor_name, ',') > 0
        AND initial.last_name_key = c.last_name_key
        AND initial.first_initial = c.first_initial
    )
    INSERT INTO instructor_course_links (
      term_id, subject, number, instructor_name,
      gpa_id, rmp_id
    )
    SELECT
      term_id,
      subject,
      number,
      instructor_name,
      gpa_id,
      rmp_id
    FROM resolved
    WHERE true
    ON CONFLICT(term_id, subject, number, instructor_name) DO UPDATE SET
      gpa_id = excluded.gpa_id,
      rmp_id = excluded.rmp_id
  `).bind(options.termId, options.year, options.term);

  const batchResult = await db.batch([deleteStatement, insertStatement]);
  const linkCount = batchResult[1]?.meta?.changes ?? 0;
  return { contextCount: linkCount, linkCount };
}

/**
 * Propagates course-wide GPA averages from gpa_stats to the courses table.
 */
export async function enrichCoursesWithGpa(db: D1Database): Promise<void> {
  const deleteAverages = db.prepare(`
    DELETE FROM gpa_stats
    WHERE instructor IS NULL
  `);
  const insertAverages = db.prepare(`
    INSERT INTO gpa_stats (subject, number, instructor, avg_gpa, sample_size)
    SELECT
      subject,
      number,
      NULL as instructor,
      CAST(SUM(avg_gpa * sample_size) AS REAL) / SUM(sample_size) as avg_gpa,
      SUM(sample_size) as sample_size
    FROM gpa_stats
    WHERE instructor IS NOT NULL
    GROUP BY subject, number
  `);

  // Replacing the derived GPA rows is one transaction. If the aggregate insert
  // fails, the prior course-average rows remain intact.
  await db.batch([deleteAverages, insertAverages]);

  // Publish the complete course GPA projection in one SQLite statement. The
  // correlated subqueries intentionally yield NULL for courses absent from the
  // new generation, but no public row changes until the statement commits.
  await db.prepare(`
    UPDATE courses
    SET
      avg_gpa = (
        SELECT g.avg_gpa
        FROM gpa_stats g
        WHERE g.instructor IS NULL
          AND g.subject = courses.subject
          AND g.number = courses.number
        LIMIT 1
      ),
      gpa_sample_size = (
        SELECT g.sample_size
        FROM gpa_stats g
        WHERE g.instructor IS NULL
          AND g.subject = courses.subject
          AND g.number = courses.number
        LIMIT 1
      )
  `).run();
}

export async function enrichCoursesWithScores(db: D1Database): Promise<{ updated: number }> {
  const publishScores = db.prepare(`
    WITH evidence AS (
      SELECT
        c.id, c.avg_gpa, c.gpa_sample_size,
        SUM(CASE
          WHEN r.rating > 0 AND r.num_ratings >= ${COURSE_SCORE_POLICY.QUALITY.MIN_RMP_RATINGS}
          THEN r.rating * r.num_ratings ELSE 0
        END) / NULLIF(SUM(CASE
          WHEN r.rating > 0 AND r.num_ratings >= ${COURSE_SCORE_POLICY.QUALITY.MIN_RMP_RATINGS}
          THEN r.num_ratings ELSE 0
        END), 0) AS rating,
        SUM(CASE WHEN r.rating > 0 AND r.num_ratings >= ${COURSE_SCORE_POLICY.QUALITY.MIN_RMP_RATINGS}
          THEN r.num_ratings ELSE 0 END) AS rating_count,
        SUM(CASE
          WHEN r.difficulty > 0 AND r.num_ratings >= ${COURSE_SCORE_POLICY.DIFFICULTY.MIN_RMP_RATINGS}
          THEN r.difficulty * r.num_ratings ELSE 0
        END) / NULLIF(SUM(CASE
          WHEN r.difficulty > 0 AND r.num_ratings >= ${COURSE_SCORE_POLICY.DIFFICULTY.MIN_RMP_RATINGS}
          THEN r.num_ratings ELSE 0
        END), 0) AS difficulty,
        SUM(CASE WHEN r.difficulty > 0 AND r.num_ratings >= ${COURSE_SCORE_POLICY.DIFFICULTY.MIN_RMP_RATINGS}
          THEN r.num_ratings ELSE 0 END) AS difficulty_count
      FROM courses c
      LEFT JOIN instructor_course_links l
        ON l.term_id = CAST(c.year AS TEXT) || '-' || c.term
        AND l.subject = c.subject
        AND l.number = c.number
        AND instr(
          ';' || replace(trim(COALESCE(c.primary_instructor, '')), '; ', ';') || ';',
          ';' || trim(l.instructor_name) || ';'
        ) > 0
      LEFT JOIN rmp_cache r
        ON l.rmp_id = r.rmp_id AND r.expires_at > unixepoch()
      GROUP BY c.id
    ),
    scores AS (
      SELECT
        id,
        CASE WHEN gpa_sample_size >= ${COURSE_SCORE_POLICY.QUALITY.MIN_GPA_RECORDS}
          AND rating_count >= ${COURSE_SCORE_POLICY.QUALITY.MIN_RMP_RATINGS}
          THEN round(
            min(100, max(0, (avg_gpa - ${COURSE_SCORE_POLICY.RANGES.GPA_MIN}) * 100
              / (${COURSE_SCORE_POLICY.RANGES.GPA_MAX} - ${COURSE_SCORE_POLICY.RANGES.GPA_MIN})))
              * ${COURSE_SCORE_POLICY.QUALITY.GPA_WEIGHT}
            + min(100, max(0, (rating - ${COURSE_SCORE_POLICY.RANGES.RMP_MIN}) * 100
              / (${COURSE_SCORE_POLICY.RANGES.RMP_MAX} - ${COURSE_SCORE_POLICY.RANGES.RMP_MIN})))
              * ${COURSE_SCORE_POLICY.QUALITY.RMP_WEIGHT}, 1)
        END AS quality_score,
        CASE WHEN difficulty_count >= ${COURSE_SCORE_POLICY.DIFFICULTY.MIN_RMP_RATINGS}
          THEN round(min(100, max(0, (difficulty - ${COURSE_SCORE_POLICY.RANGES.RMP_MIN}) * 100
            / (${COURSE_SCORE_POLICY.RANGES.RMP_MAX} - ${COURSE_SCORE_POLICY.RANGES.RMP_MIN}))), 1)
        END AS difficulty_score,
        CASE WHEN rating_count >= ${COURSE_SCORE_POLICY.QUALITY.MIN_RMP_RATINGS}
          THEN rating END AS primary_instructor_rmp
      FROM evidence
    )
    UPDATE courses AS target
    SET
      quality_score = scores.quality_score,
      difficulty_score = scores.difficulty_score,
      primary_instructor_rmp = scores.primary_instructor_rmp
    FROM scores WHERE target.id = scores.id
  `);
  const results = await db.batch([publishScores, db.prepare('SELECT COUNT(*) AS updated FROM courses')]);
  const count = results[1]?.results?.[0] as { updated?: number } | undefined;
  return { updated: count?.updated ?? 0 };
}
