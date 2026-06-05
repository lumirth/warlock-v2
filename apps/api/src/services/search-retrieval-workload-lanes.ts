import type { D1Database } from "@cloudflare/workers-types";
import type { SearchFilters } from "./search-planner-types.js";
import { buildFilteredCourseQuery } from "./search-lane-query-builder.js";
import {
  rankedLaneRow,
  type WorkloadLaneRow,
} from "./search-retrieval-lane-result.js";

export async function workloadEvidenceLaneSearch(
  db: D1Database,
  filters: SearchFilters,
  signalTypes: string[],
  limit: number = 50,
): Promise<WorkloadLaneRow[]> {
  if (signalTypes.length === 0) {
    return [];
  }

  const filtered = buildFilteredCourseQuery(filters);
  const signalPlaceholders = signalTypes.map(() => "?").join(",");
  const signalCondition = `cs.signal_type IN (${signalPlaceholders})`;

  const sql = `
    SELECT c.id,
      GROUP_CONCAT(DISTINCT cs.signal_type) as claims,
      MAX(COALESCE(cs.confidence, 0) * COALESCE(cs.value, 0)) as evidence_score
    FROM course_signals cs
    JOIN courses c ON c.id = cs.course_id
    ${filtered.joinSql}
    ${filtered.whereSql([signalCondition])}
    ${filtered.groupBySql("c.id")}
    ORDER BY evidence_score DESC, c.year DESC, c.subject, c.number
    LIMIT ?
  `;

  const result = await db.prepare(sql)
    .bind(...filtered.bindParams(signalTypes, [limit]))
    .all<{ id: string; claims: string | null; evidence_score: number | null }>();

  return result.results.map((row, index) => {
    const claims = row.claims?.split(",").filter(Boolean) ?? [];
    return {
      ...rankedLaneRow(
        "workload_evidence",
        row.id,
        index,
        "Structured workload or subjective evidence recall.",
        {
          rawScore: row.evidence_score,
          matchedTerms: signalTypes,
          evidence: claims,
        },
      ),
      claims,
    };
  });
}
