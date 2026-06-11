import type { D1Database } from "@cloudflare/workers-types";
import type { SearchRequestFiltersDto } from "@uiuc-course-search/query-types";
import type { SearchFilters } from "./search-planner-types.js";
import { resolveInstructorIds } from "./query-resolver.js";

export async function resolveSearchRequestFilters(
  db: D1Database,
  requestFilters?: SearchRequestFiltersDto,
): Promise<Partial<SearchFilters> | undefined> {
  if (!requestFilters) return undefined;

  const filters: Partial<SearchFilters> = {};
  if (requestFilters.subject !== undefined) filters.subject = requestFilters.subject;
  if (requestFilters.number !== undefined) filters.number = requestFilters.number;
  if (requestFilters.term !== undefined) filters.term = requestFilters.term;
  if (requestFilters.year !== undefined) filters.year = requestFilters.year;
  if (requestFilters.requirement !== undefined) {
    filters.requirement = requestFilters.requirement;
  }
  if (requestFilters.credits !== undefined) filters.credits = requestFilters.credits;
  if (requestFilters.days !== undefined) filters.days = requestFilters.days;
  if (requestFilters.time !== undefined) filters.time = requestFilters.time;
  if (requestFilters.partOfTerm !== undefined) {
    filters.partOfTerm = requestFilters.partOfTerm;
  }
  if (requestFilters.online !== undefined) filters.online = requestFilters.online;
  if (requestFilters.status !== undefined) filters.status = requestFilters.status;
  if (requestFilters.workload !== undefined) {
    filters.workload = requestFilters.workload;
  }
  if (requestFilters.level !== undefined) filters.level = requestFilters.level;
  if (requestFilters.instructor !== undefined) {
    filters.instructor_ids = await resolveInstructorIds(db, requestFilters.instructor);
  }

  return Object.keys(filters).length > 0 ? filters : undefined;
}
