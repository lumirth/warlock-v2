import type { D1Database } from "@cloudflare/workers-types";
import type { CourseRequirementDto } from "@uiuc-course-search/query-types";
import { canonicalRequirementCode } from "../services/requirement-codes.js";

const SEARCH_DTO_BATCH_SIZE = 50;

export async function loadSearchResultRequirements(
  db: D1Database,
  courseIds: string[],
): Promise<Map<string, CourseRequirementDto[]>> {
  const requirementsByCourseId = new Map<string, CourseRequirementDto[]>();
  const uniqueIds = [...new Set(courseIds)].filter(Boolean);

  for (let index = 0; index < uniqueIds.length; index += SEARCH_DTO_BATCH_SIZE) {
    const batch = uniqueIds.slice(index, index + SEARCH_DTO_BATCH_SIZE);
    const placeholders = batch.map(() => "?").join(",");
    const result = await db
      .prepare(
        `
        SELECT course_id, category_id, category_name, attribute_code, attribute_name
        FROM course_gened
        WHERE course_id IN (${placeholders})
        ORDER BY category_id, attribute_code
        `,
      )
      .bind(...batch)
      .all<{
        course_id: string;
        category_id: string;
        category_name: string | null;
        attribute_code: string | null;
        attribute_name: string | null;
      }>();

    for (const row of result.results) {
      const requirements = requirementsByCourseId.get(row.course_id) ?? [];
      requirements.push({
        categoryId: row.category_id,
        categoryName: row.category_name,
        attributeCode: canonicalRequirementCode(row.attribute_code),
        attributeName: row.attribute_name,
      });
      requirementsByCourseId.set(row.course_id, requirements);
    }
  }

  return requirementsByCourseId;
}
