import type { D1Database } from "@cloudflare/workers-types";
import {
  type CourseRegistrationSummaryDto,
  type CourseRequirementDto,
} from "@uiuc-course-search/query-types";
import type { Course } from '../db/types.js';
import {
  courseRequirementRowToDto,
  type CourseRequirementSourceRow,
} from "../transforms/course-requirements.js";
import { normalizeSectionAvailability } from "./section-availability-policy.js";

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

export async function fetchRequirementsByCourseId(
  db: D1Database,
  courseIds: string[],
): Promise<Map<string, CourseRequirementDto[]>> {
  const requirementsByCourseId = new Map<string, CourseRequirementDto[]>();
  if (courseIds.length === 0) {
    return requirementsByCourseId;
  }

  for (const batch of chunkValues([...new Set(courseIds)], D1_ID_BATCH_SIZE)) {
    const placeholders = batch.map(() => "?").join(",");
    const result = await db.prepare(`
      SELECT course_id, category_id, category_name, attribute_code, attribute_name
      FROM course_gened
      WHERE course_id IN (${placeholders})
      ORDER BY category_id, attribute_code
    `).bind(...batch).all<CourseRequirementSourceRow & {
      course_id: string;
    }>();

    for (const row of result.results) {
      const requirements = requirementsByCourseId.get(row.course_id) ?? [];
      requirements.push(courseRequirementRowToDto(row));
      requirementsByCourseId.set(row.course_id, requirements);
    }
  }

  return requirementsByCourseId;
}

type SectionRegistrationSummaryRow = {
  course_id: string;
  status: string | null;
  status_code: string | null;
  section_status_code: string | null;
  last_synced: number | null;
};

export async function fetchRegistrationSummariesByCourseId(
  db: D1Database,
  courseIds: string[],
): Promise<Map<string, CourseRegistrationSummaryDto>> {
  const uniqueCourseIds = [...new Set(courseIds)];
  const summaries = new Map(
    uniqueCourseIds.map((courseId) => [
      courseId,
      emptyRegistrationSummary(),
    ]),
  );
  const hasUnknownFreshness = new Set<string>();

  for (const batch of chunkValues(uniqueCourseIds, D1_ID_BATCH_SIZE)) {
    const placeholders = batch.map(() => "?").join(",");
    const result = await db.prepare(`
      SELECT
        course_id,
        status,
        status_code,
        section_status_code,
        last_synced
      FROM sections
      WHERE course_id IN (${placeholders})
    `).bind(...batch).all<SectionRegistrationSummaryRow>();

    for (const row of result.results) {
      const summary = summaries.get(row.course_id);
      if (!summary) continue;

      const availability = normalizeSectionAvailability({
        status: row.status,
        statusCode: row.status_code,
        sectionStatusCode: row.section_status_code,
      }).status;
      summary.total += 1;
      summary[availability] += 1;
      if (typeof row.last_synced !== "number") {
        hasUnknownFreshness.add(row.course_id);
        summary.lastSynced = null;
      } else if (!hasUnknownFreshness.has(row.course_id)) {
        summary.lastSynced = summary.lastSynced === null
          ? row.last_synced
          : Math.min(summary.lastSynced, row.last_synced);
      }
    }
  }

  return summaries;
}

function emptyRegistrationSummary(): CourseRegistrationSummaryDto {
  return {
    total: 0,
    open: 0,
    restricted: 0,
    waitlisted: 0,
    closed: 0,
    cancelled: 0,
    unknown: 0,
    lastSynced: null,
  };
}

export function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
}
