import type { D1Database } from '@cloudflare/workers-types';
import { resolveInstructor } from './matcher.js';

/**
 * Resolves instructor names for active courses and links them to GPA/RMP data.
 * The results are stored in instructor_course_links for runtime lookup.
 */
export async function enrichCoursesWithScoring(db: D1Database): Promise<void> {
  console.log('[Enrichment] Starting Context-Aware Instructor Linking...');

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
    console.warn('[Enrichment] No active term found. Skipping linking.');
    return;
  }
  const { term_id: termId, year: activeYear, term: activeTerm } = termResult;
  console.log(`[Enrichment] Using active term: ${termId} (Year: ${activeYear}, Term: ${activeTerm})`);

  // 2. Fetch unique (subject, number, primary_instructor) for the active term
  const coursesResult = await db.prepare(`
    SELECT DISTINCT subject, number, primary_instructor
    FROM courses
    WHERE year = ? AND term = ? AND primary_instructor IS NOT NULL
  `).bind(activeYear, activeTerm).all<{ subject: string; number: string; primary_instructor: string }>();

  if (!coursesResult.success) {
    console.error('[Enrichment] Failed to fetch active courses.');
    return;
  }

  const courses = coursesResult.results;
  console.log(`[Enrichment] Found ${courses.length} courses with instructors for linking.`);

  // 3. Extract unique instructor/course tuples to minimize resolution calls
  const uniqueLinks = new Set<string>();
  const linkTasks: { termId: string; subject: string; number: string; instructorName: string }[] = [];

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

  console.log(`[Enrichment] Resolving ${linkTasks.length} unique instructor-course links...`);

  // 4. Resolve and Upsert
  const BATCH_SIZE = 50;
  let resolvedCount = 0;

  for (let i = 0; i < linkTasks.length; i += BATCH_SIZE) {
    const chunk = linkTasks.slice(i, i + BATCH_SIZE);
    const statements: any[] = [];

    for (const task of chunk) {
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
          'gpa_bridge'
        ));
        resolvedCount++;
      }
    }

    if (statements.length > 0) {
      try {
        await db.batch(statements);
      } catch (err) {
        console.error(`[Enrichment] Failed to batch upsert links at index ${i}:`, err);
      }
    }

    if (i > 0 && i % 500 === 0) {
      console.log(`[Enrichment] Progress: ${i} / ${linkTasks.length} links processed...`);
    }
  }

  console.log(`[Enrichment] Finished. Linked ${resolvedCount} instructors across ${linkTasks.length} unique contexts.`);
}

export async function enrichCoursesWithGpa(db: D1Database): Promise<void> {
  console.log('[Enrichment] Starting GPA aggregation and enrichment...');

  // 1. Calculate and UPSERT course-wide averages (instructor IS NULL)
  // We calculate the weighted average across all instructors for each course
  try {
    console.log('[Enrichment] Aggregating course stats...');
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
    console.log('[Enrichment] Aggregation complete.');
  } catch (err) {
    console.error('[Enrichment] Failed to aggregate course stats:', err);
    // Continue anyway, maybe some stats exist
  }

  // 2. Get course-wide averages that have changed or are missing in courses table
  // Optimization: Join with courses table to only fetch rows where values differ
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

  if (!result.success) {
    console.error('[Enrichment] Failed to fetch GPA stats.');
    return;
  }

  const updates = result.results;
  console.log(`[Enrichment] Found ${updates.length} course stats to propagate (skipping unchanged).`);

  // 3. Update courses in batches using D1 batching
  // We use a larger batch size since we are only processing diffs
  const BATCH_SIZE = 500;
  let updatedCount = 0;

  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const chunk = updates.slice(i, i + BATCH_SIZE);

    // Update all matching courses (historical and current) for this subject/number
    // This is a "fan-out" update - one GPA stat applies to many course rows (years/terms)
    const statements = chunk.map(stat =>
      db.prepare(`
        UPDATE courses
        SET avg_gpa = ?, gpa_sample_size = ?
        WHERE subject = ? AND number = ?
      `).bind(stat.avg_gpa, stat.sample_size, stat.subject, stat.number)
    );

    try {
      await db.batch(statements);
      updatedCount += chunk.length;
    } catch (err) {
      console.error(`[Enrichment] Failed to update batch starting at index ${i}:`, err);
    }
  }

  console.log(`[Enrichment] Finished. Propagated stats to ${updatedCount} course definitions.`);

  // Chain the new scoring enrichment
  await enrichCoursesWithScoring(db);
}
