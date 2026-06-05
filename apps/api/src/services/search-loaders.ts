import type { D1Database } from "@cloudflare/workers-types";
import type { Course } from '../db/types.js';
import { canonicalRequirementCode } from "./requirement-codes.js";

const D1_ID_BATCH_SIZE = 50;

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

export async function fetchRequirementCodesByCourseId(
  db: D1Database,
  courseIds: string[],
): Promise<Map<string, string[]>> {
  const requirementCodesByCourseId = new Map<string, string[]>();
  if (courseIds.length === 0) {
    return requirementCodesByCourseId;
  }

  for (const batch of chunkValues([...new Set(courseIds)], D1_ID_BATCH_SIZE)) {
    const placeholders = batch.map(() => "?").join(",");
    const result = await db.prepare(`
      SELECT course_id, category_id, attribute_code
      FROM course_gened
      WHERE course_id IN (${placeholders})
      ORDER BY category_id, attribute_code
    `).bind(...batch).all<{
      course_id: string;
      category_id: string;
      attribute_code: string | null;
    }>();

    for (const row of result.results) {
      const codes = requirementCodesByCourseId.get(row.course_id) ?? [];
      for (const value of [row.category_id, row.attribute_code]) {
        const code = canonicalRequirementCode(value);
        if (code && !codes.includes(code)) {
          codes.push(code);
        }
      }
      requirementCodesByCourseId.set(row.course_id, codes);
    }
  }

  return requirementCodesByCourseId;
}

export function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
}
