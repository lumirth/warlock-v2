import type { D1Database } from "@cloudflare/workers-types";
import type { SearchRequestFiltersDto } from "@uiuc-course-search/query-types";
import type { SearchFilters } from "./search-planner-types.js";
import { resolveInstructorIds } from "./query-resolver.js";

export async function resolveSearchRequestFilters(
  db: D1Database,
  requestFilters?: SearchRequestFiltersDto,
): Promise<Partial<SearchFilters> | undefined> {
  if (!requestFilters) return undefined;

  const {
    instructor,
    instructorDifficulty,
    ...publicFilters
  } = requestFilters;
  const filters: Partial<SearchFilters> = {
    ...publicFilters,
    instructorDifficulty,
  };
  if (instructor !== undefined) {
    filters.instructor_ids = await resolveInstructorIds(db, instructor);
  }

  return Object.keys(filters).length > 0 ? filters : undefined;
}
