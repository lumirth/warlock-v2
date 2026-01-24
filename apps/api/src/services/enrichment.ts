import type { D1Database, Fetcher } from '@cloudflare/workers-types';
import { resolveInstructor } from './matcher.js';

export interface EnrichmentTask {
  termId: string;
  subject: string;
  number: string;
  instructorName: string;
}

const ENRICHMENT_BATCH_SIZE = 10;

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

  console.log(`[Enrichment Coord] Found ${linkTasks.length} unique instructor-course contexts. Checking for missing links...`);

  // 3. Filter by existing links (Incremental Strategy)
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

  console.log(`[Enrichment Coord] Total contexts: ${linkTasks.length}, Missing: ${missingTasks.length}`);

  if (missingTasks.length === 0) {
    return { taskCount: 0, batchCount: 0 };
  }

  // 4. Shuffle and Slice (Strict limit for Free Tier compatibility)
  const shuffled = [...missingTasks];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const chunk = shuffled.slice(0, ENRICHMENT_BATCH_SIZE);

  console.log(`[Enrichment Coord] Dispatching 1 batch of ${chunk.length} tasks.`);

  // 5. Dispatch Batch (Fan-Out)
  await selfBinding.fetch('http://internal/internal/enrich-batch', {
    method: 'POST',
    body: JSON.stringify({ tasks: chunk }),
    headers: { 'Content-Type': 'application/json' }
  });

  return { taskCount: chunk.length, batchCount: 1 };
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
