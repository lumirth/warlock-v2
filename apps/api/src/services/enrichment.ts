import type { D1Database } from '@cloudflare/workers-types';

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
  const BATCH_SIZE = 50;
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
}
