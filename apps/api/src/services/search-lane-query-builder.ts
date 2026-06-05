import type { RetrievalLane, SearchFilters } from "./search-planner-types.js";
import {
  buildFilterClauses,
  type FilterClauseResult,
  type FilterJoinKey,
} from "./search-filters.js";

export type LaneSpec = {
  lane: RetrievalLane;
  source: string;
  resultReason: string;
};

export const RETRIEVAL_LANE_SPECS: Record<RetrievalLane, LaneSpec> = {
  exact: {
    lane: "exact",
    source: "course code, CRN, or exact title facts",
    resultReason: "Exact course or CRN lookup.",
  },
  official_text: {
    lane: "official_text",
    source: "catalog FTS and official course fields",
    resultReason: "Official course text recall.",
  },
  requirement: {
    lane: "requirement",
    source: "structured requirement mappings",
    resultReason: "Structured requirement mapping recall.",
  },
  section_text: {
    lane: "section_text",
    source: "section-level FTS fields",
    resultReason: "Section text FTS recall.",
  },
  structured_section: {
    lane: "structured_section",
    source: "term, modality, meeting, status, and part-of-term facts",
    resultReason: "Structured section constraint recall.",
  },
  student_language_alias: {
    lane: "student_language_alias",
    source: "student-language alias FTS",
    resultReason: "Student-language alias FTS recall.",
  },
  topic_semantic: {
    lane: "topic_semantic",
    source: "semantic sidecar results",
    resultReason: "Semantic topic recall.",
  },
  workload_evidence: {
    lane: "workload_evidence",
    source: "workload and subjective course signals",
    resultReason: "Structured workload or subjective evidence recall.",
  },
  help_path: {
    lane: "help_path",
    source: "help and advising-path content",
    resultReason: "Help-path recall.",
  },
};

export type FilteredCourseQuery = FilterClauseResult & {
  joinSql: string;
  joinSqlExcluding: (excludedKeys: readonly FilterJoinKey[]) => string;
  whereSql: (extraConditions?: readonly string[]) => string;
  groupBySql: (fallbackGroupBy?: string) => string;
  bindParams: (...paramGroups: readonly (readonly (string | number)[])[]) => (string | number)[];
};

export function buildFilteredCourseQuery(filters: SearchFilters): FilteredCourseQuery {
  const clauses = buildFilterClauses(filters);
  return {
    ...clauses,
    joinSql: clauses.joins.join(" "),
    joinSqlExcluding(excludedKeys: readonly FilterJoinKey[]) {
      const excluded = new Set(excludedKeys);
      return clauses.joinKeys
        .map((key, index) => excluded.has(key) ? null : clauses.joins[index])
        .filter((join): join is string => Boolean(join))
        .join(" ");
    },
    whereSql(extraConditions: readonly string[] = []) {
      const allConditions = [...clauses.where, ...extraConditions];
      return allConditions.length > 0
        ? `WHERE ${allConditions.join(" AND ")}`
        : "";
    },
    groupBySql(fallbackGroupBy?: string) {
      return fallbackGroupBy ? `GROUP BY ${fallbackGroupBy}` : "";
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
