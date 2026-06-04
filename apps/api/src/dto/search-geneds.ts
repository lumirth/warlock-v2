import type { D1Database } from "@cloudflare/workers-types";
import type { CourseGenedDto } from "@uiuc-course-search/query-types";
import { canonicalGenedCode } from "../services/gened-codes.js";

const SEARCH_DTO_BATCH_SIZE = 50;

export async function loadSearchResultGeneds(
  db: D1Database,
  courseIds: string[],
): Promise<Map<string, CourseGenedDto[]>> {
  const genedsByCourseId = new Map<string, CourseGenedDto[]>();
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
      const geneds = genedsByCourseId.get(row.course_id) ?? [];
      geneds.push({
        categoryId: row.category_id,
        categoryName: row.category_name,
        attributeCode: canonicalGenedCode(row.attribute_code),
        attributeName: row.attribute_name,
      });
      genedsByCourseId.set(row.course_id, geneds);
    }
  }

  return genedsByCourseId;
}
