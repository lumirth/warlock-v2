import type { D1Database } from "@cloudflare/workers-types";
import type { Course } from '../db/types.js';

const D1_ID_BATCH_SIZE = 50;

export async function fetchQualityScores(
  db: D1Database,
  courseIds: string[],
): Promise<Map<string, number>> {
  const qualityScores = new Map<string, number>();
  if (courseIds.length === 0) {
    return qualityScores;
  }

  for (const batch of chunkValues(courseIds, D1_ID_BATCH_SIZE)) {
    const placeholders = batch.map(() => "?").join(",");
    const result = await db.prepare(`
      SELECT id, quality_score FROM courses WHERE id IN (${placeholders})
    `).bind(...batch).all<{ id: string; quality_score: number | null }>();

    for (const row of result.results) {
      if (row.quality_score !== null && row.quality_score !== undefined) {
        qualityScores.set(row.id, row.quality_score);
      }
    }
  }

  return qualityScores;
}

export async function fetchCoursesById(
  db: D1Database,
  courseIds: string[],
): Promise<Map<string, Course>> {
  const courseMap = new Map<string, Course>();
  if (courseIds.length === 0) {
    return courseMap;
  }

  for (const batch of chunkValues(courseIds, D1_ID_BATCH_SIZE)) {
    const placeholders = batch.map(() => "?").join(",");
    const result = await db.prepare(`
      SELECT
        c.*,
        g.median_gpa as median_gpa
      FROM courses c
      LEFT JOIN gpa_stats g
        ON g.subject = c.subject
        AND g.number = c.number
        AND g.instructor IS NULL
      WHERE c.id IN (${placeholders})
    `).bind(...batch).all<Course>();

    for (const course of result.results) {
      courseMap.set(course.id, course);
    }
  }

  return courseMap;
}

export function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
}
