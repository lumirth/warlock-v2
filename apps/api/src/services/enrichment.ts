import type { D1Database, Fetcher } from '@cloudflare/workers-types';
import { resolveInstructor } from './matcher.js';
import { internalAuthHeaders } from '../middleware/auth.js';
import { errorFields, logger } from '../observability/logger.js';

export interface EnrichmentTask {
  termId: string;
  subject: string;
  number: string;
  instructorName: string;
}

const ENRICHMENT_BATCH_SIZE = 10;
const MAX_ENRICHMENT_BATCHES_PER_RUN = 40;
const SCORE_UPDATE_BATCH_SIZE = 500;

type CourseScoreSource = {
  id: string;
  avg_gpa: number | null;
  primary_instructor_rmp: number | null;
  linked_rmp_rating: number | null;
  linked_rmp_difficulty: number | null;
};

export type CourseScoreResult = {
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

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function scoreFromGpa(avgGpa: number): number {
  return clampScore((avgGpa / 4) * 100);
}

function scoreFromRmpRating(rating: number): number {
  return clampScore((rating / 5) * 100);
}

function difficultyFromGpa(avgGpa: number): number {
  return clampScore(100 - scoreFromGpa(avgGpa));
}

function difficultyFromRmp(difficulty: number): number {
  return clampScore((difficulty / 5) * 100);
}

export function calculateCourseScores(source: CourseScoreSource): CourseScoreResult {
  const rmpRating = source.primary_instructor_rmp ?? source.linked_rmp_rating;
  const qualityParts = [
    typeof source.avg_gpa === 'number' ? scoreFromGpa(source.avg_gpa) : null,
    typeof rmpRating === 'number' ? scoreFromRmpRating(rmpRating) : null,
  ].filter((value): value is number => value !== null);

  const difficultyParts = [
    typeof source.avg_gpa === 'number' ? difficultyFromGpa(source.avg_gpa) : null,
    typeof source.linked_rmp_difficulty === 'number' ? difficultyFromRmp(source.linked_rmp_difficulty) : null,
  ].filter((value): value is number => value !== null);

  const quality = average(qualityParts);
  const difficulty = average(difficultyParts);

  return {
    qualityScore: quality === null ? null : roundScore(quality),
    difficultyScore: difficulty === null ? null : roundScore(difficulty),
    primaryInstructorRmp: rmpRating ?? null,
  };
}

/**
 * Coordinator: Identifies all unique instructor-course contexts and dispatches batches.
 */
export async function coordinateEnrichment(
  db: D1Database,
  selfBinding: Fetcher,
  internalToken?: string
): Promise<{ taskCount: number; batchCount: number }> {
  const termResult = await db.prepare(`
    SELECT term_id, year, term FROM term_state
    WHERE status = 'active'
    ORDER BY year DESC, CASE term
      WHEN 'fall' THEN 4
      WHEN 'summer' THEN 3
      WHEN 'spring' THEN 2
      WHEN 'winter' THEN 1
    END DESC
    LIMIT 1
  `).first<{ term_id: string; year: number; term: string }>();

  if (!termResult) {
    return { taskCount: 0, batchCount: 0 };
  }
  const { term_id: termId, year: activeYear, term: activeTerm } = termResult;

  const coursesResult = await db.prepare(`
    SELECT DISTINCT subject, number, primary_instructor
    FROM courses
    WHERE year = ? AND term = ? AND primary_instructor IS NOT NULL
  `).bind(activeYear, activeTerm).all<{ subject: string; number: string; primary_instructor: string }>();

  if (!coursesResult.success) {
    throw new Error('[Enrichment Coord] Failed to fetch active courses.');
  }

  const courses = coursesResult.results;
  const uniqueLinks = new Set<string>();
  const linkTasks: EnrichmentTask[] = [];

  for (const course of courses) {
    const instructors = course.primary_instructor.split(';').map(s => s.trim()).filter(Boolean);
    for (const name of instructors) {
      const key = `${termId}|${course.subject}|${course.number}|${name}`;
      if (!uniqueLinks.has(key)) {
        uniqueLinks.add(key);
        linkTasks.push({ termId, subject: course.subject, number: course.number, instructorName: name });
      }
    }
  }

  linkTasks.sort(compareEnrichmentTasks);

  const existingLinksResult = await db.prepare(`
    SELECT term_id, subject, number, instructor_name FROM instructor_course_links
    WHERE term_id = ?
  `).bind(termId).all<{ term_id: string; subject: string; number: string; instructor_name: string }>();

  const existingSet = new Set<string>();
  if (existingLinksResult.success) {
    for (const row of existingLinksResult.results) {
      existingSet.add(`${row.term_id}|${row.subject}|${row.number}|${row.instructor_name}`);
    }
  }

  const missingTasks = linkTasks.filter(t => !existingSet.has(`${t.termId}|${t.subject}|${t.number}|${t.instructorName}`));

  if (missingTasks.length === 0) {
    await updateEnrichmentState(db, termId, 'complete', 0, 0);
    return { taskCount: 0, batchCount: 0 };
  }

  const maxTasks = ENRICHMENT_BATCH_SIZE * MAX_ENRICHMENT_BATCHES_PER_RUN;
  const tasksForRun = missingTasks.slice(0, maxTasks);
  const batches = chunkTasks(tasksForRun, ENRICHMENT_BATCH_SIZE);

  await updateEnrichmentState(db, termId, 'running', 0, batches.length);

  let dispatchedTasks = 0;
  for (const batch of batches) {
    const response = await selfBinding.fetch('http://internal/internal/enrich-batch', {
      method: 'POST',
      body: JSON.stringify({ tasks: batch }),
      headers: {
        'Content-Type': 'application/json',
        ...internalAuthHeaders(internalToken),
      }
    });

    if (!response.ok) {
      await updateEnrichmentState(db, termId, 'failed', dispatchedTasks, batches.length);
      throw new Error(`Failed to dispatch enrichment batch: ${response.status}`);
    }

    dispatchedTasks += batch.length;
    await updateEnrichmentState(db, termId, 'running', dispatchedTasks, batches.length);
  }

  const status = tasksForRun.length < missingTasks.length ? 'partial' : 'complete';
  await updateEnrichmentState(db, termId, status, dispatchedTasks, batches.length);

  return { taskCount: dispatchedTasks, batchCount: batches.length };
}

function compareEnrichmentTasks(a: EnrichmentTask, b: EnrichmentTask): number {
  return `${a.termId}|${a.subject}|${a.number}|${a.instructorName}`
    .localeCompare(`${b.termId}|${b.subject}|${b.number}|${b.instructorName}`);
}

function chunkTasks<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function updateEnrichmentState(
  db: D1Database,
  termId: string,
  status: string,
  taskCount: number,
  batchCount: number
): Promise<void> {
  await db.prepare(`
    INSERT INTO sync_state (id, last_sync, last_status, items_synced, cursor, etag)
    VALUES (?, unixepoch(), ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      last_sync = excluded.last_sync,
      last_status = excluded.last_status,
      items_synced = excluded.items_synced,
      cursor = excluded.cursor,
      etag = excluded.etag
  `).bind(`enrichment:${termId}`, status, taskCount, batchCount, termId).run();
}

/**
 * Batch Worker: Processes a subset of instructor-course contexts.
 */
export async function processEnrichmentBatch(db: D1Database, tasks: EnrichmentTask[]): Promise<number> {
  const statements: D1PreparedStatement[] = [];
  let resolvedCount = 0;

  for (const task of tasks) {
    const match = await resolveInstructor(db, {
      subject: task.subject,
      number: task.number,
      instructorName: task.instructorName
    });

    if (match) {
      statements.push(db.prepare(`
        INSERT INTO instructor_course_links (
          term_id, subject, number, instructor_name,
          gpa_id, rmp_id, confidence_score, match_method
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(term_id, subject, number, instructor_name) DO UPDATE SET
          gpa_id = excluded.gpa_id,
          rmp_id = excluded.rmp_id,
          confidence_score = excluded.confidence_score,
          match_method = excluded.match_method
      `).bind(
        task.termId,
        task.subject,
        task.number,
        task.instructorName,
        match.gpaId || null,
        match.rmpId || null,
        1.0,
        match.gpaId ? 'gpa_bridge' : 'direct_rmp'
      ));
      resolvedCount++;
    } else {
      // Mark as failed to prevent infinite retry loop
      statements.push(db.prepare(`
        INSERT INTO instructor_course_links (
          term_id, subject, number, instructor_name,
          gpa_id, rmp_id, confidence_score, match_method
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(term_id, subject, number, instructor_name) DO UPDATE SET
          gpa_id = excluded.gpa_id,
          rmp_id = excluded.rmp_id,
          confidence_score = excluded.confidence_score,
          match_method = excluded.match_method
      `).bind(
        task.termId,
        task.subject,
        task.number,
        task.instructorName,
        null,
        null,
        0,
        'failed'
      ));
    }
  }

  if (statements.length > 0) {
    const CHUNK_SIZE = 50; 
    for (let i = 0; i < statements.length; i += CHUNK_SIZE) {
      await db.batch(statements.slice(i, i + CHUNK_SIZE));
    }
    await enrichCoursesWithScores(db);
  }

  return resolvedCount;
}

/**
 * Propagates course-wide GPA averages from gpa_stats to the courses table.
 */
export async function enrichCoursesWithGpa(db: D1Database): Promise<void> {
  try {
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
      ON CONFLICT(subject, number, instructor) DO UPDATE SET
        avg_gpa = excluded.avg_gpa,
        sample_size = excluded.sample_size,
        last_updated = excluded.last_updated
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
      AVG(r.rating) as linked_rmp_rating,
      AVG(r.difficulty) as linked_rmp_difficulty
    FROM courses c
    LEFT JOIN instructor_course_links l
      ON l.term_id = CAST(c.year AS TEXT) || '-' || c.term
      AND l.subject = c.subject
      AND l.number = c.number
    LEFT JOIN rmp_cache r ON l.rmp_id = r.rmp_id
    GROUP BY c.id
    HAVING
      c.avg_gpa IS NOT NULL
      OR c.primary_instructor_rmp IS NOT NULL
      OR AVG(r.rating) IS NOT NULL
      OR AVG(r.difficulty) IS NOT NULL
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
          primary_instructor_rmp = COALESCE(primary_instructor_rmp, ?),
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
