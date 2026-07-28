import type { D1Database } from '@cloudflare/workers-types';
import type { SearchSort } from '@uiuc-course-search/query-types';

const SORT_VALUE_BATCH_SIZE = 50;

/**
 * Orders a SQL retrieval lane by the same public attribute semantics used by
 * final in-memory ordering. Null values always follow known values; the lane's
 * normal relevance expression remains the deterministic tie-breaker.
 */
export function courseSqlOrderBy(
  sort: SearchSort,
  relevanceOrder: string,
): string {
  if (sort.field === 'relevance') return relevanceOrder;

  const expression = courseSortExpression(sort.field);
  const direction = sort.direction === 'asc' ? 'ASC' : 'DESC';
  return `(${expression}) IS NULL ASC, ${expression} ${direction}, ${relevanceOrder}`;
}

/**
 * Reconciles independently limited SQL lanes before hydration. Every SQL lane
 * already returns its strongest attribute-sorted candidates; this final pass
 * orders their union by the same value so retrieval-fusion weights cannot push
 * a weaker attribute match into the bounded hydration window.
 */
export async function orderRetrievedCandidatesByCourseSort<
  T extends { id: string },
>(
  db: D1Database,
  candidates: T[],
  sort: SearchSort,
): Promise<T[]> {
  if (sort.field === 'relevance' || candidates.length < 2) {
    return candidates;
  }

  const expression = courseSortExpression(sort.field);
  const sortValues = new Map<string, number | null>();

  for (let index = 0; index < candidates.length; index += SORT_VALUE_BATCH_SIZE) {
    const batch = candidates.slice(index, index + SORT_VALUE_BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(',');
    const result = await db.prepare(`
      SELECT c.id, ${expression} AS sort_value
      FROM courses c
      WHERE c.id IN (${placeholders})
    `)
      .bind(...batch.map((candidate) => candidate.id))
      .all<{ id: string; sort_value: number | null }>();

    for (const row of result.results) {
      sortValues.set(
        row.id,
        typeof row.sort_value === 'number' && Number.isFinite(row.sort_value)
          ? row.sort_value
          : null,
      );
    }
  }

  return candidates
    .map((candidate, relevanceIndex) => ({
      candidate,
      relevanceIndex,
      value: sortValues.get(candidate.id) ?? null,
    }))
    .sort((left, right) => {
      if (left.value === null && right.value === null) {
        return left.relevanceIndex - right.relevanceIndex;
      }
      if (left.value === null) return 1;
      if (right.value === null) return -1;
      if (left.value === right.value) {
        return left.relevanceIndex - right.relevanceIndex;
      }
      return sort.direction === 'asc'
        ? left.value - right.value
        : right.value - left.value;
    })
    .map(({ candidate }) => candidate);
}

function courseSortExpression(field: SearchSort['field']): string {
  switch (field) {
    case 'gpa':
      return 'c.avg_gpa';
    case 'quality':
      return `CASE
        WHEN c.quality_score IS NULL THEN NULL
        WHEN c.quality_score >= 85 THEN 4
        WHEN c.quality_score >= 70 THEN 3
        WHEN c.quality_score >= 50 THEN 2
        ELSE 1
      END`;
    case 'instructor_difficulty':
      return `CASE
        WHEN c.difficulty_score IS NULL THEN NULL
        WHEN c.difficulty_score > 75 THEN 3
        WHEN c.difficulty_score > 45 THEN 2
        ELSE 1
      END`;
    case 'instructor_rating':
      return 'c.primary_instructor_rmp';
    case 'level':
      return `CASE
        WHEN c.number GLOB '[0-9]*' THEN CAST(c.number AS INTEGER)
        ELSE NULL
      END`;
    case 'credits':
      return 'c.credit_hours';
    case 'relevance':
      return 'NULL';
  }
}
