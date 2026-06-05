import type { D1Database } from "@cloudflare/workers-types";
import { hasRequirementFilter } from "@uiuc-course-search/query-types";
import type { SearchFilters } from "./search-planner-types.js";
import {
  buildFilteredCourseQuery,
  hasFilteredCourseConstraints,
  RETRIEVAL_LANE_SPECS,
} from "./search-lane-query-builder.js";
import {
  rankedLaneRow,
  type RankedLaneRow,
} from "./search-retrieval-lane-result.js";

export async function requirementLaneSearch(
  db: D1Database,
  filters: SearchFilters,
  limit: number = 50,
): Promise<RankedLaneRow[]> {
  const hasFilter = hasRequirementFilter(filters);

  if (!hasFilter) {
    return [];
  }

  const filtered = buildFilteredCourseQuery(filters);

  if (!hasFilteredCourseConstraints(filtered)) {
    return [];
  }

  const sql = `
    SELECT DISTINCT c.id
    FROM courses c
    ${filtered.joinSql}
    ${filtered.whereSql()}
    ${filtered.groupBySql()}
    ORDER BY c.year DESC, c.subject, c.number
    LIMIT ?
  `;

  const result = await db.prepare(sql)
    .bind(...filtered.bindParams([limit]))
    .all<{ id: string }>();

  return result.results.map((row, index) => rankedLaneRow(
    "requirement",
    row.id,
    index,
    RETRIEVAL_LANE_SPECS.requirement.resultReason,
  ));
}
