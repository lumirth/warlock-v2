import type { D1Database } from '@cloudflare/workers-types';
import type { SyncRunStatus } from '../db/types.js';
import { upsertSyncState } from '../db/sync-state-repository.js';
import {
  COURSE_SCORE_POLICY,
  normalizeGpa,
  normalizeRmp,
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

type CourseScoreSource = {
  id: string;
  avg_gpa: number | null;
  gpa_sample_size?: number | null;
  primary_instructor_rmp?: number | null;
  linked_rmp_rating: number | null;
  linked_rmp_difficulty: number | null;
  linked_rmp_num_ratings?: number | null;
};

type CourseScoreResult = {
  qualityScore: number | null;
  difficultyScore: number | null;
  primaryInstructorRmp: number | null;
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function roundScore(value: number): number {
  return Math.round(value * 10) / 10;
}

function scoreFromGpa(avgGpa: number): number {
  return clampScore(normalizeGpa(avgGpa));
}

function scoreFromRmpRating(rating: number): number {
  return clampScore(normalizeRmp(rating));
}

function difficultyFromRmp(rmpDifficulty: number): number {
  return clampScore(normalizeRmp(rmpDifficulty));
}

export function calculateCourseScores(source: CourseScoreSource): CourseScoreResult {
  const hasGpaEvidence =
    typeof source.avg_gpa === 'number'
    && (source.gpa_sample_size ?? 0) >= COURSE_SCORE_POLICY.QUALITY.MIN_GPA_RECORDS;
  const hasRmpEvidence =
    typeof source.linked_rmp_rating === 'number'
    && source.linked_rmp_rating > 0
    && (source.linked_rmp_num_ratings ?? 0) >= COURSE_SCORE_POLICY.QUALITY.MIN_RMP_RATINGS;
  const hasDifficultyEvidence =
    typeof source.linked_rmp_difficulty === 'number'
    && source.linked_rmp_difficulty > 0
    && (source.linked_rmp_num_ratings ?? 0) >= COURSE_SCORE_POLICY.DIFFICULTY.MIN_RMP_RATINGS;

  const quality = hasGpaEvidence && hasRmpEvidence
    ? (
        scoreFromGpa(source.avg_gpa as number) * COURSE_SCORE_POLICY.QUALITY.GPA_WEIGHT
        + scoreFromRmpRating(source.linked_rmp_rating as number) * COURSE_SCORE_POLICY.QUALITY.RMP_WEIGHT
      )
    : null;
  const difficulty = hasDifficultyEvidence
    ? difficultyFromRmp(source.linked_rmp_difficulty as number)
    : null;

  return {
    qualityScore: quality === null ? null : roundScore(quality),
    difficultyScore: difficulty === null ? null : roundScore(difficulty),
    primaryInstructorRmp: hasRmpEvidence ? source.linked_rmp_rating : null,
  };
}

/**
 * Coordinator: Identifies all unique instructor-course contexts and dispatches batches.
 */
export async function coordinateEnrichment(
  db: D1Database
): Promise<{ taskCount: number; batchCount: number; linkCount: number; scoreUpdateCount: number }> {
  let taskCount = 0;
  let linkCount = 0;
  await updateEnrichmentState(db, 'running', 0);

  try {
    const termResult = await db.prepare(`
      SELECT term_id, year, term FROM term_state
      WHERE status IN ('registrable', 'active')
      ORDER BY
        CASE status WHEN 'registrable' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,
        year DESC, CASE term
        WHEN 'fall' THEN 4
        WHEN 'summer' THEN 3
        WHEN 'spring' THEN 2
        WHEN 'winter' THEN 1
      END DESC
    `).all<{ term_id: string; year: number; term: string }>();

    if (!termResult.success) {
      throw new Error('Failed to load terms for enrichment');
    }

    for (const term of termResult.results) {
      const linkResult = await rebuildInstructorCourseLinks(db, {
        termId: term.term_id,
        year: term.year,
        term: term.term,
      });
      taskCount += linkResult.contextCount;
      linkCount += linkResult.linkCount;
    }

    const scores = await enrichCoursesWithScores(db);
    await updateEnrichmentState(db, 'complete', taskCount);

    return {
      taskCount,
      batchCount: termResult.results.length,
      linkCount,
      scoreUpdateCount: scores.updated,
    };
  } catch (error) {
    await updateEnrichmentState(db, 'failed', taskCount);
    throw error;
  }
}

export async function rebuildInstructorCourseLinks(
  db: D1Database,
  options: { termId: string; year: number; term: string }
): Promise<{ contextCount: number; linkCount: number }> {
  const countResult = await db.prepare(`
    WITH contexts AS (${INSTRUCTOR_COURSE_CONTEXTS_SQL})
    SELECT COUNT(*) AS context_count
    FROM contexts
  `).bind(options.termId, options.year, options.term).first<{ context_count: number }>();

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

  // D1 batch() is transactional: a failed insert rolls back the delete, so a
  // term never exposes an empty or half-rebuilt link set.
  const batchResult = await db.batch([deleteStatement, insertStatement]);
  const linkCount = batchResult[1]?.meta?.changes ?? 0;

  return {
    contextCount: countResult?.context_count ?? 0,
    linkCount,
  };
}

async function updateEnrichmentState(
  db: D1Database,
  status: SyncRunStatus,
  taskCount: number
): Promise<void> {
  await upsertSyncState(db, {
    id: 'enrichment',
    last_sync: Math.floor(Date.now() / 1000),
    last_status: status,
    items_synced: taskCount,
    cursor: null,
    etag: null,
  });
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
    INSERT INTO gpa_stats (subject, number, instructor, avg_gpa, median_gpa, sample_size, last_updated)
    SELECT
      subject,
      number,
      NULL as instructor,
      CAST(SUM(avg_gpa * sample_size) AS REAL) / SUM(sample_size) as avg_gpa,
      NULL as median_gpa,
      SUM(sample_size) as sample_size,
      unixepoch() as last_updated
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
      ),
      updated_at = unixepoch()
  `).run();
}

/**
 * Computes normalized 0-100 course quality and difficulty scores from available GPA/RMP data.
 */
export async function enrichCoursesWithScores(db: D1Database): Promise<{ updated: number }> {
  const publishScores = db.prepare(`
    WITH score_sources AS (
      SELECT
        c.id,
        c.avg_gpa,
        c.gpa_sample_size,
        SUM(CASE
          WHEN r.rating > 0
            AND COALESCE(r.num_ratings, 0) >= ${COURSE_SCORE_POLICY.QUALITY.MIN_RMP_RATINGS}
          THEN r.rating * r.num_ratings
        END) / NULLIF(SUM(CASE
          WHEN r.rating > 0
            AND COALESCE(r.num_ratings, 0) >= ${COURSE_SCORE_POLICY.QUALITY.MIN_RMP_RATINGS}
          THEN r.num_ratings ELSE 0
        END), 0) as linked_rmp_rating,
        SUM(CASE
          WHEN r.difficulty > 0
            AND COALESCE(r.num_ratings, 0) >= ${COURSE_SCORE_POLICY.DIFFICULTY.MIN_RMP_RATINGS}
          THEN r.difficulty * r.num_ratings
        END) / NULLIF(SUM(CASE
          WHEN r.difficulty > 0
            AND COALESCE(r.num_ratings, 0) >= ${COURSE_SCORE_POLICY.DIFFICULTY.MIN_RMP_RATINGS}
          THEN r.num_ratings ELSE 0
        END), 0) as linked_rmp_difficulty,
        SUM(CASE
          WHEN (
            (r.rating > 0 AND COALESCE(r.num_ratings, 0) >= ${COURSE_SCORE_POLICY.QUALITY.MIN_RMP_RATINGS})
            OR (
              r.difficulty > 0
              AND COALESCE(r.num_ratings, 0) >= ${COURSE_SCORE_POLICY.DIFFICULTY.MIN_RMP_RATINGS}
            )
          )
          THEN r.num_ratings ELSE 0
        END) as linked_rmp_num_ratings
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
        ON l.rmp_id = r.rmp_id
        AND r.expires_at > unixepoch()
      GROUP BY c.id
    ),
    computed_scores AS (
      SELECT
        id,
        CASE
          WHEN avg_gpa IS NOT NULL
            AND COALESCE(gpa_sample_size, 0) >= ${COURSE_SCORE_POLICY.QUALITY.MIN_GPA_RECORDS}
            AND linked_rmp_rating > 0
            AND linked_rmp_num_ratings >= ${COURSE_SCORE_POLICY.QUALITY.MIN_RMP_RATINGS}
          THEN round(
            (
              CASE
                WHEN avg_gpa <= ${COURSE_SCORE_POLICY.RANGES.GPA_MIN} THEN 0
                WHEN avg_gpa >= ${COURSE_SCORE_POLICY.RANGES.GPA_MAX} THEN 100
                ELSE (
                  (avg_gpa - ${COURSE_SCORE_POLICY.RANGES.GPA_MIN})
                  / (
                    ${COURSE_SCORE_POLICY.RANGES.GPA_MAX}
                    - ${COURSE_SCORE_POLICY.RANGES.GPA_MIN}
                  )
                ) * 100
              END
            ) * ${COURSE_SCORE_POLICY.QUALITY.GPA_WEIGHT}
            + (
              CASE
                WHEN linked_rmp_rating <= ${COURSE_SCORE_POLICY.RANGES.RMP_MIN} THEN 0
                WHEN linked_rmp_rating >= ${COURSE_SCORE_POLICY.RANGES.RMP_MAX} THEN 100
                ELSE (
                  (linked_rmp_rating - ${COURSE_SCORE_POLICY.RANGES.RMP_MIN})
                  / (
                    ${COURSE_SCORE_POLICY.RANGES.RMP_MAX}
                    - ${COURSE_SCORE_POLICY.RANGES.RMP_MIN}
                  )
                ) * 100
              END
            ) * ${COURSE_SCORE_POLICY.QUALITY.RMP_WEIGHT},
            1
          )
          ELSE NULL
        END AS quality_score,
        CASE
          WHEN linked_rmp_difficulty > 0
            AND linked_rmp_num_ratings >= ${COURSE_SCORE_POLICY.DIFFICULTY.MIN_RMP_RATINGS}
          THEN round(
            CASE
              WHEN linked_rmp_difficulty <= ${COURSE_SCORE_POLICY.RANGES.RMP_MIN} THEN 0
              WHEN linked_rmp_difficulty >= ${COURSE_SCORE_POLICY.RANGES.RMP_MAX} THEN 100
              ELSE (
                (linked_rmp_difficulty - ${COURSE_SCORE_POLICY.RANGES.RMP_MIN})
                / (
                  ${COURSE_SCORE_POLICY.RANGES.RMP_MAX}
                  - ${COURSE_SCORE_POLICY.RANGES.RMP_MIN}
                )
              ) * 100
            END,
            1
          )
          ELSE NULL
        END AS difficulty_score,
        CASE
          WHEN linked_rmp_rating > 0
            AND linked_rmp_num_ratings >= ${COURSE_SCORE_POLICY.QUALITY.MIN_RMP_RATINGS}
          THEN linked_rmp_rating
          ELSE NULL
        END AS primary_instructor_rmp
      FROM score_sources
    )
    UPDATE courses AS target
    SET
      quality_score = computed_scores.quality_score,
      difficulty_score = computed_scores.difficulty_score,
      primary_instructor_rmp = computed_scores.primary_instructor_rmp,
      updated_at = unixepoch()
    FROM computed_scores
    WHERE target.id = computed_scores.id
  `);
  const countUpdatedCourses = db.prepare(`
    SELECT COUNT(*) AS updated
    FROM courses
  `);

  // The source aggregation, score calculation, stale-value clearing, and
  // publication are one SQLite statement. The scalar count shares its atomic
  // D1 batch because D1's changes metadata includes FTS-trigger writes and
  // therefore does not truthfully represent the number of courses updated.
  const results = await db.batch([publishScores, countUpdatedCourses]);
  const count = results[1]?.results?.[0] as { updated?: number } | undefined;
  return { updated: count?.updated ?? 0 };
}
