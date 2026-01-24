import type { D1Database } from '@cloudflare/workers-types';
import { SCORING, bayesianAverage, normalizeGpa, normalizeRmp } from './scoring-constants.js';

/**
 * Calculates and updates composite quality/difficulty scores for courses
 * based on the active term's instructors.
 */
export async function enrichCoursesWithScoring(db: D1Database): Promise<void> {
  console.log('[Enrichment] Starting Contextual Scoring...');

  // 1. Get Active Term (Most relevant future term)
  // We prioritize 'active' terms with the highest year/term combo
  // In a real scenario, this would come from a config or "current_term" logic
  // For now, we query the latest term ID from term_state
  const termResult = await db.prepare(`
    SELECT term_id FROM term_state
    WHERE status = 'active'
    ORDER BY year DESC, CASE term
      WHEN 'fall' THEN 4
      WHEN 'summer' THEN 3
      WHEN 'spring' THEN 2
      WHEN 'winter' THEN 1
    END DESC
    LIMIT 1
  `).first<{ term_id: string }>();

  if (!termResult) {
    console.warn('[Enrichment] No active term found. Skipping scoring.');
    return;
  }
  const activeTermId = termResult.term_id;
  console.log(`[Enrichment] Using active term: ${activeTermId}`);

  // 2. Fetch Aggregated Instructor Data for Active Courses
  // This query joins courses -> sections -> instructors to get the roster for the active term
  // It handles the "Weighted Average by Section Count" logic in SQL
  const statsResult = await db.prepare(`
    WITH ActiveInstructors AS (
      -- Get all instructors teaching in the active term, weighted by sections
      SELECT
        c.subject,
        c.number,
        i.rmp_rating,
        i.rmp_difficulty,
        i.num_ratings as rmp_count,
        i.avg_gpa as instructor_gpa,
        COUNT(s.section_id) as section_count
      FROM courses c
      JOIN sections s ON c.course_id = s.course_id
      JOIN instructors i ON s.instructor_id = i.id
      WHERE c.term_id = ?
      GROUP BY c.subject, c.number, i.id
    ),
    CourseHistory AS (
      -- Get historical fallback data (course-wide averages)
      SELECT subject, number, avg_gpa FROM gpa_stats WHERE instructor IS NULL
    )
    SELECT
      ai.subject,
      ai.number,
      -- Aggregated metrics (weighted by section_count)
      SUM(ai.rmp_rating * ai.section_count) / SUM(ai.section_count) as weighted_rmp,
      SUM(ai.rmp_difficulty * ai.section_count) / SUM(ai.section_count) as weighted_rmp_diff,
      SUM(ai.instructor_gpa * ai.section_count) / SUM(ai.section_count) as weighted_gpa,
      SUM(ai.rmp_count) as total_rmp_ratings,
      SUM(ai.section_count) as total_sections,
      ch.avg_gpa as fallback_gpa
    FROM ActiveInstructors ai
    LEFT JOIN CourseHistory ch ON ai.subject = ch.subject AND ai.number = ch.number
    GROUP BY ai.subject, ai.number
  `).bind(activeTermId).all<{
    subject: string;
    number: string;
    weighted_rmp: number | null;
    weighted_rmp_diff: number | null;
    weighted_gpa: number | null;
    total_rmp_ratings: number;
    total_sections: number;
    fallback_gpa: number | null;
  }>();

  if (!statsResult.success) {
    console.error('[Enrichment] Failed to fetch scoring stats.');
    return;
  }

  const courseStats = statsResult.results;
  console.log(`[Enrichment] Scoring ${courseStats.length} active courses...`);

  const updates = courseStats.map(stat => {
    // A. Resolve Metrics (Bayesian Smoothing & Fallbacks)

    // GPA: Use Instructor Weighted Average -> Fallback to Course History -> Default 3.0
    const finalGpa = stat.weighted_gpa || stat.fallback_gpa || 3.0;

    // RMP Rating: Use Bayesian Average -> Default to Global Mean (3.5) if no data
    // If weighted_rmp is null, count is 0
    const rawRmp = stat.weighted_rmp || SCORING.BAYESIAN.GLOBAL_RMP_RATING;
    const rmpCount = stat.total_rmp_ratings || 0;
    const finalRmp = bayesianAverage(rawRmp, rmpCount, SCORING.BAYESIAN.GLOBAL_RMP_RATING);

    // RMP Difficulty: Similar Bayesian logic -> Default 3.0
    const rawRmpDiff = stat.weighted_rmp_diff || SCORING.BAYESIAN.GLOBAL_RMP_DIFFICULTY;
    const finalRmpDiff = bayesianAverage(rawRmpDiff, rmpCount, SCORING.BAYESIAN.GLOBAL_RMP_DIFFICULTY);

    // B. Calculate Composite Scores (0-100)

    // Quality Score = (RMP_Norm * 0.7) + (GPA_Norm * 0.3)
    const normRmp = normalizeRmp(finalRmp);
    const normGpa = normalizeGpa(finalGpa);
    const qualityScore = (normRmp * SCORING.QUALITY.RMP_WEIGHT) + (normGpa * SCORING.QUALITY.GPA_WEIGHT);

    // Difficulty Score = (GPA_Diff_Norm * 0.5) + (RMP_Diff_Norm * 0.5)
    // Note: normalizeGpa gives 100 for 4.0 (Easy). We want Difficulty, so invert it.
    // Inverted GPA: 4.0 -> 0 Diff, 2.0 -> 100 Diff.
    // normalizeGpa(4.0) = 100. 100 - 100 = 0.
    // normalizeGpa(2.0) = 0. 100 - 0 = 100.
    const normGpaDiff = 100 - normGpa;
    const normRmpDiff = normalizeRmp(finalRmpDiff); // 5.0 -> 100 Diff
    const difficultyScore = (normGpaDiff * SCORING.DIFFICULTY.GPA_WEIGHT) + (normRmpDiff * SCORING.DIFFICULTY.RMP_WEIGHT);

    return {
      subject: stat.subject,
      number: stat.number,
      quality_score: Math.round(qualityScore),
      difficulty_score: Math.round(difficultyScore)
    };
  });

  // 3. Batch Updates
  const BATCH_SIZE = 50;
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const chunk = updates.slice(i, i + BATCH_SIZE);
    const statements = chunk.map(u =>
      db.prepare(`
        UPDATE courses
        SET quality_score = ?, difficulty_score = ?
        WHERE subject = ? AND number = ?
      `).bind(u.quality_score, u.difficulty_score, u.subject, u.number)
    );

    await db.batch(statements);
  }

  console.log(`[Enrichment] Finished. Updated scores for ${updates.length} courses.`);
}

export async function enrichCoursesWithGpa(db: D1Database): Promise<void> {
  // ... existing implementation ...
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

  // Chain the new scoring enrichment
  await enrichCoursesWithScoring(db);
}
