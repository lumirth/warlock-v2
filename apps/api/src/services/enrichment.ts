import type { D1Database, Fetcher } from '@cloudflare/workers-types';
import { resolveInstructor } from './matcher.js';

export interface EnrichmentTask {
  termId: string;
  subject: string;
  number: string;
  instructorName: string;
}

/**
 * Coordinator: Identifies all unique instructor-course contexts and dispatches batches.
 */
export async function coordinateEnrichment(db: D1Database, selfBinding: Fetcher): Promise<{ taskCount: number; batchCount: number }> {
  console.log('[Enrichment Coord] Starting Context-Aware Instructor Linking...');

  // 1. Get Active Term
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
    console.warn('[Enrichment Coord] No active term found. Skipping linking.');
    return { taskCount: 0, batchCount: 0 };
  }
  const { term_id: termId, year: activeYear, term: activeTerm } = termResult;

  // 2. Fetch unique (subject, number, primary_instructor) for the active term
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

  console.log(`[Enrichment Coord] Found ${linkTasks.length} unique instructor-course contexts. Dispatching batches...`);

  // 3. Dispatch Batches (Fan-Out)
  // BATCH_SIZE 100 ensures the batch worker stays well under the 1000 subrequest limit
  const BATCH_SIZE = 100;
  let batchCount = 0;

  for (let i = 0; i < linkTasks.length; i += BATCH_SIZE) {
    const chunk = linkTasks.slice(i, i + BATCH_SIZE);
    batchCount++;

    await selfBinding.fetch('http://internal/internal/enrich-batch', {
      method: 'POST',
      body: JSON.stringify({ tasks: chunk }),
      headers: { 'Content-Type': 'application/json' }
    });
  }

  console.log(`[Enrichment Coord] Dispatched ${batchCount} batches.`);
  return { taskCount: linkTasks.length, batchCount };
}

/**
 * Batch Worker: Processes a subset of instructor-course contexts.
 */
export async function processEnrichmentBatch(db: D1Database, tasks: EnrichmentTask[]): Promise<number> {
  console.log(`[Enrichment Batch] Processing ${tasks.length} tasks...`);
  
  const statements: any[] = [];
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
    }
  }

  if (statements.length > 0) {
    const CHUNK_SIZE = 50; 
    for (let i = 0; i < statements.length; i += CHUNK_SIZE) {
      await db.batch(statements.slice(i, i + CHUNK_SIZE));
    }
  }

  return resolvedCount;
}

/**
 * Propagates course-wide GPA averages from gpa_stats to the courses table.
 */
export async function enrichCoursesWithGpa(db: D1Database): Promise<void> {
  console.log('[Enrichment] Starting GPA aggregation...');

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
    console.error('[Enrichment] Failed to aggregate course stats:', err);
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

  console.log(`[Enrichment] Propagated stats to ${updates.length} courses.`);
}
