import type { SearchFilters } from "./search-planner-types.js";
import type { SearchScope } from "@uiuc-course-search/query-types";
import {
  buildFilterClauses,
  filterJoinSql,
  type FilterClauseResult,
  type FilterJoinKey,
} from "./search-filters.js";

type FilteredCourseQuery = FilterClauseResult & {
  joinSql: string;
  joinSqlExcluding: (excludedKeys: readonly FilterJoinKey[]) => string;
  whereSql: (extraConditions?: readonly string[]) => string;
  groupBySql: (groupBy: string) => string;
  bindParams: (...paramGroups: readonly (readonly (string | number)[])[]) => (string | number)[];
};

export type CandidateSqlQuery = {
  sql: string;
  params: (string | number)[];
};

export function buildFilteredCourseQuery(
  filters: SearchFilters,
  scope: SearchScope = "all",
): FilteredCourseQuery {
  const clauses = buildFilterClauses(filters);
  if (scope === "active" && !filters.term && !filters.year) {
    clauses.where.push(`EXISTS (
      SELECT 1 FROM term_state search_scope_term
      WHERE search_scope_term.year = c.year
        AND search_scope_term.term = c.term
        AND search_scope_term.status IN ('active', 'registrable')
    )`);
  }
  return {
    ...clauses,
    joinSql: filterJoinSql(clauses.joins),
    joinSqlExcluding: (excludedKeys) => filterJoinSql(clauses.joins, excludedKeys),
    whereSql(extraConditions: readonly string[] = []) {
      const allConditions = [...clauses.where, ...extraConditions];
      return allConditions.length > 0
        ? `WHERE ${allConditions.join(" AND ")}`
        : "";
    },
    groupBySql(groupBy: string) {
      return `GROUP BY ${groupBy}`;
    },
    bindParams(...paramGroups) {
      return [
        ...clauses.params,
        ...paramGroups.flat(),
      ];
    },
  };
}

export function hasFilteredCourseConstraints(query: FilteredCourseQuery): boolean {
  return query.joins.length > 0
    || query.where.length > 0;
}
