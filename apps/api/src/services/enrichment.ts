import type { D1Database, Fetcher } from '@cloudflare/workers-types';
import type { SyncRunStatus } from '../db/types.js';
import { errorFields, logger } from '../observability/logger.js';
import {
  COURSE_SCORE_POLICY,
  normalizeGpa,
  normalizeGpaWorkload,
  normalizeRmp,
} from './course-score-policy.js';

const SCORE_UPDATE_BATCH_SIZE = 500;
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
  primary_instructor_rmp: number | null;
  linked_rmp_rating: number | null;
  linked_rmp_difficulty: number | null;
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

function weightedAverage(parts: Array<{ value: number | null; weight: number }>): number | null {
  const availableParts = parts.filter((part): part is { value: number; weight: number } => part.value !== null);
  const totalWeight = availableParts.reduce((total, part) => total + part.weight, 0);

  if (totalWeight === 0) return null;

  return availableParts.reduce((total, part) => total + part.value * part.weight, 0) / totalWeight;
}

function scoreFromGpa(avgGpa: number): number {
  return clampScore(normalizeGpa(avgGpa));
}

function scoreFromRmpRating(rating: number): number {
  return clampScore(normalizeRmp(rating));
}

function validRmpMetric(value: number | null | undefined): number | null {
  return typeof value === 'number' && value > 0 ? value : null;
}

function workloadFromGpa(avgGpa: number): number {
  return clampScore(normalizeGpaWorkload(avgGpa));
}

function workloadFromRmp(rmpDifficulty: number): number {
  return clampScore(normalizeRmp(rmpDifficulty));
}

export function calculateCourseScores(source: CourseScoreSource): CourseScoreResult {
  const rmpRating = validRmpMetric(source.linked_rmp_rating) ?? validRmpMetric(source.primary_instructor_rmp);
  const rmpDifficulty = validRmpMetric(source.linked_rmp_difficulty);
  const quality = weightedAverage([
    {
      value: typeof source.avg_gpa === 'number' ? scoreFromGpa(source.avg_gpa) : null,
      weight: COURSE_SCORE_POLICY.QUALITY.GPA_WEIGHT,
    },
    {
      value: typeof rmpRating === 'number' ? scoreFromRmpRating(rmpRating) : null,
      weight: COURSE_SCORE_POLICY.QUALITY.RMP_WEIGHT,
    },
  ]);

  const workload = weightedAverage([
    {
      value: typeof source.avg_gpa === 'number' ? workloadFromGpa(source.avg_gpa) : null,
      weight: COURSE_SCORE_POLICY.WORKLOAD.GPA_WEIGHT,
    },
    {
      value: rmpDifficulty === null ? null : workloadFromRmp(rmpDifficulty),
      weight: COURSE_SCORE_POLICY.WORKLOAD.RMP_WEIGHT,
    },
  ]);

  return {
    qualityScore: quality === null ? null : roundScore(quality),
    difficultyScore: workload === null ? null : roundScore(workload),
    primaryInstructorRmp: rmpRating ?? null,
  };
}

/**
 * Coordinator: Identifies all unique instructor-course contexts and dispatches batches.
 */
export async function coordinateEnrichment(
  db: D1Database,
  _selfBinding: Fetcher,
  _internalToken?: string
): Promise<{ taskCount: number; batchCount: number; linkCount: number; scoreUpdateCount: number }> {
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

  if (!termResult.success || termResult.results.length === 0) {
    return { taskCount: 0, batchCount: 0, linkCount: 0, scoreUpdateCount: 0 };
  }

  let taskCount = 0;
  let linkCount = 0;
  for (const term of termResult.results) {
    await updateEnrichmentState(db, term.term_id, 'running', 0);
    const linkResult = await rebuildInstructorCourseLinks(db, {
      termId: term.term_id,
      year: term.year,
      term: term.term,
    });
    taskCount += linkResult.contextCount;
    linkCount += linkResult.linkCount;
    await updateEnrichmentState(db, term.term_id, 'complete', linkResult.contextCount);
  }

  const scores = await enrichCoursesWithScores(db);

  return {
    taskCount,
    batchCount: termResult.results.length,
    linkCount,
    scoreUpdateCount: scores.updated,
  };
}

async function rebuildInstructorCourseLinks(
  db: D1Database,
  options: { termId: string; year: number; term: string }
): Promise<{ contextCount: number; linkCount: number }> {
  const countResult = await db.prepare(`
    WITH contexts AS (${INSTRUCTOR_COURSE_CONTEXTS_SQL})
    SELECT COUNT(*) AS context_count
    FROM contexts
  `).bind(options.termId, options.year, options.term).first<{ context_count: number }>();

  await db.prepare(`
    DELETE FROM instructor_course_links
    WHERE term_id = ?
  `).bind(options.termId).run();

  const insertResult = await db.prepare(`
    WITH contexts AS (${INSTRUCTOR_COURSE_CONTEXTS_SQL}),
    gpa_matches AS (
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
            AND g.instructor LIKE c.instructor_name || '%'
          ORDER BY g.sample_size DESC
          LIMIT 1
        ) AS gpa_id,
        (
          SELECT g.instructor
          FROM gpa_stats g
          WHERE g.subject = c.subject
            AND g.number = c.number
            AND g.instructor LIKE c.instructor_name || '%'
          ORDER BY g.sample_size DESC
          LIMIT 1
        ) AS gpa_instructor
      FROM contexts c
    ),
    resolved AS (
      SELECT
        g.term_id,
        g.subject,
        g.number,
        g.instructor_name,
        g.gpa_id,
        (
          SELECT r.rmp_id
          FROM rmp_cache r
          WHERE r.instructor_name = CASE
            WHEN g.gpa_instructor IS NOT NULL AND instr(g.gpa_instructor, ',') > 0
              THEN trim(substr(g.gpa_instructor, 1, instr(g.gpa_instructor, ',') - 1))
                || ', '
                || upper(substr(trim(substr(g.gpa_instructor, instr(g.gpa_instructor, ',') + 1)), 1, 1))
            ELSE g.gpa_instructor
          END
          LIMIT 1
        ) AS bridge_rmp_id,
        (
          SELECT r.rmp_id
          FROM rmp_cache r
          WHERE r.instructor_name = CASE
            WHEN instr(g.instructor_name, ',') > 0
              THEN trim(substr(g.instructor_name, 1, instr(g.instructor_name, ',') - 1))
                || ', '
                || upper(substr(trim(substr(g.instructor_name, instr(g.instructor_name, ',') + 1)), 1, 1))
            ELSE g.instructor_name
          END
          LIMIT 1
        ) AS direct_rmp_id
      FROM gpa_matches g
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
      COALESCE(bridge_rmp_id, direct_rmp_id)
    FROM resolved
    WHERE true
    ON CONFLICT(term_id, subject, number, instructor_name) DO UPDATE SET
      gpa_id = excluded.gpa_id,
      rmp_id = excluded.rmp_id
  `).bind(options.termId, options.year, options.term).run();

  const linkCount = insertResult.meta?.changes ?? 0;

  return {
    contextCount: countResult?.context_count ?? 0,
    linkCount,
  };
}

async function updateEnrichmentState(
  db: D1Database,
  termId: string,
  status: SyncRunStatus,
  taskCount: number
): Promise<void> {
  await db.prepare(`
    INSERT INTO sync_state (id, last_sync, last_status, items_synced, cursor, etag)
    VALUES (?, unixepoch(), ?, ?, NULL, NULL)
    ON CONFLICT(id) DO UPDATE SET
      last_sync = excluded.last_sync,
      last_status = excluded.last_status,
      items_synced = excluded.items_synced,
      cursor = excluded.cursor,
      etag = excluded.etag
  `).bind(`enrichment:${termId}`, status, taskCount).run();
}

/**
 * Propagates course-wide GPA averages from gpa_stats to the courses table.
 */
export async function enrichCoursesWithGpa(db: D1Database): Promise<void> {
  try {
    await db.prepare(`
      DELETE FROM gpa_stats
      WHERE instructor IS NULL
    `).run();

    await db.prepare(`
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
    `).run();
  } catch (err) {
    logger.error('enrichment.aggregateCourseStats.failed', { ...errorFields(err) });
  }

  const result = await db.prepare(`
    SELECT
      g.subject,
      g.number,
      g.avg_gpa,
      g.sample_size
    FROM gpa_stats g
    LEFT JOIN courses c ON g.subject = c.subject AND g.number = c.number
    WHERE g.instructor IS NULL
    AND (
      c.avg_gpa IS NULL
      OR ABS(c.avg_gpa - g.avg_gpa) > 0.01
      OR c.gpa_sample_size != g.sample_size
    )
  `).all<{ subject: string; number: string; avg_gpa: number; sample_size: number }>();

  if (!result.success) return;

  const updates = result.results;
  const BATCH_SIZE = 500;

  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const chunk = updates.slice(i, i + BATCH_SIZE);
    const statements = chunk.map(stat =>
      db.prepare(`
        UPDATE courses
        SET avg_gpa = ?, gpa_sample_size = ?
        WHERE subject = ? AND number = ?
      `).bind(stat.avg_gpa, stat.sample_size, stat.subject, stat.number)
    );
    await db.batch(statements);
  }

}

/**
 * Computes normalized 0-100 course quality and difficulty scores from available GPA/RMP data.
 */
export async function enrichCoursesWithScores(db: D1Database): Promise<{ updated: number }> {
  const result = await db.prepare(`
    SELECT
      c.id,
      c.avg_gpa,
      c.primary_instructor_rmp,
      AVG(CASE WHEN r.rating > 0 AND COALESCE(r.num_ratings, 0) > 0 THEN r.rating END) as linked_rmp_rating,
      AVG(CASE WHEN r.difficulty > 0 AND COALESCE(r.num_ratings, 0) > 0 THEN r.difficulty END) as linked_rmp_difficulty
    FROM courses c
    LEFT JOIN instructor_course_links l
      ON l.term_id = CAST(c.year AS TEXT) || '-' || c.term
      AND l.subject = c.subject
      AND l.number = c.number
    LEFT JOIN rmp_cache r ON l.rmp_id = r.rmp_id
    GROUP BY c.id
    HAVING
      c.avg_gpa IS NOT NULL
      OR (c.primary_instructor_rmp IS NOT NULL AND c.primary_instructor_rmp > 0)
      OR AVG(CASE WHEN r.rating > 0 AND COALESCE(r.num_ratings, 0) > 0 THEN r.rating END) IS NOT NULL
      OR AVG(CASE WHEN r.difficulty > 0 AND COALESCE(r.num_ratings, 0) > 0 THEN r.difficulty END) IS NOT NULL
  `).all<CourseScoreSource>();

  if (!result.success || result.results.length === 0) {
    return { updated: 0 };
  }

  let updated = 0;
  for (let i = 0; i < result.results.length; i += SCORE_UPDATE_BATCH_SIZE) {
    const chunk = result.results.slice(i, i + SCORE_UPDATE_BATCH_SIZE);
    const statements = chunk.map((row) => {
      const scores = calculateCourseScores(row);
      updated++;
      return db.prepare(`
        UPDATE courses
        SET
          quality_score = ?,
          difficulty_score = ?,
          primary_instructor_rmp = ?,
          updated_at = unixepoch()
        WHERE id = ?
      `).bind(
        scores.qualityScore,
        scores.difficultyScore,
        scores.primaryInstructorRmp,
        row.id
      );
    });

    await db.batch(statements);
  }

  return { updated };
}
