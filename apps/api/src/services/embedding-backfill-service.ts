import type { Ai, D1Database, VectorizeIndex } from '@cloudflare/workers-types';
import { normalizeRequirementCodes, type CourseRequirementDto, type SearchScope } from '@uiuc-course-search/query-types';
import { canonicalRequirementCode } from './requirement-codes.js';
import {
  upsertCourseEmbeddings,
  type CourseEmbeddingData,
} from './embeddings.js';

const EMBEDDING_BACKFILL_BATCH_SIZE = 25;
const TERM_ORDER_SQL = `
  CASE c.term
    WHEN 'fall' THEN 4
    WHEN 'summer' THEN 3
    WHEN 'spring' THEN 2
    WHEN 'winter' THEN 1
    ELSE 0
  END
`;

export type EmbeddingBackfillScope = SearchScope;

export type EmbeddingBackfillCommand = {
  scope: EmbeddingBackfillScope;
  limit: number;
  offset: number;
  year?: number;
  term?: string;
};

export type EmbeddingBackfillResult = {
  scope: EmbeddingBackfillScope;
  year?: number;
  term?: string;
  limit: number;
  offset: number;
  total: number;
  processed: number;
  hasMore: boolean;
  firstCourseId: string | null;
  lastCourseId: string | null;
};

type CourseEmbeddingRow = {
  id: string;
  subject: string;
  number: string;
  title: string;
  description: string | null;
  primary_instructor: string | null;
};

type RequirementRow = {
  course_id: string;
  category_id: string;
  category_name: string | null;
  attribute_code: string | null;
  attribute_name: string | null;
};

type QueryParts = {
  whereSql: string;
  params: Array<string | number>;
};

export async function backfillCourseEmbeddings(
  db: D1Database,
  vectorize: VectorizeIndex,
  ai: Ai,
  command: EmbeddingBackfillCommand,
): Promise<EmbeddingBackfillResult> {
  const query = buildEmbeddingCourseQuery(command);
  const totalResult = await db
    .prepare(`SELECT COUNT(*) AS total FROM courses c ${query.whereSql}`)
    .bind(...query.params)
    .first<{ total: number }>();
  const total = totalResult?.total ?? 0;

  const rows = await db
    .prepare(
      `
      SELECT c.id, c.subject, c.number, c.title, c.description, c.primary_instructor
      FROM courses c
      ${query.whereSql}
      ORDER BY c.year DESC, ${TERM_ORDER_SQL} DESC, c.subject, CAST(c.number AS INTEGER), c.number, c.id
      LIMIT ? OFFSET ?
      `,
    )
    .bind(...query.params, command.limit, command.offset)
    .all<CourseEmbeddingRow>();

  const courses = rows.results;
  const requirementsByCourseId = await loadEmbeddingRequirements(db, courses.map(course => course.id));
  const embeddingData = courses.map(course => courseRowToEmbeddingData(
    course,
    requirementsByCourseId.get(course.id) ?? [],
  ));

  for (let index = 0; index < embeddingData.length; index += EMBEDDING_BACKFILL_BATCH_SIZE) {
    await upsertCourseEmbeddings(
      vectorize,
      ai,
      embeddingData.slice(index, index + EMBEDDING_BACKFILL_BATCH_SIZE),
    );
  }

  return {
    scope: command.scope,
    year: command.year,
    term: command.term,
    limit: command.limit,
    offset: command.offset,
    total,
    processed: courses.length,
    hasMore: command.offset + courses.length < total,
    firstCourseId: courses[0]?.id ?? null,
    lastCourseId: courses[courses.length - 1]?.id ?? null,
  };
}

function buildEmbeddingCourseQuery(command: EmbeddingBackfillCommand): QueryParts {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (command.scope === 'active') {
    clauses.push(`
      EXISTS (
        SELECT 1
        FROM term_state ts
        WHERE ts.year = c.year
          AND ts.term = c.term
          AND ts.status IN ('active', 'registrable')
      )
    `);
  }

  if (command.year !== undefined) {
    clauses.push('c.year = ?');
    params.push(command.year);
  }

  if (command.term !== undefined) {
    clauses.push('c.term = ?');
    params.push(command.term);
  }

  return {
    whereSql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

async function loadEmbeddingRequirements(
  db: D1Database,
  courseIds: string[],
): Promise<Map<string, CourseRequirementDto[]>> {
  const requirementsByCourseId = new Map<string, CourseRequirementDto[]>();
  const uniqueIds = [...new Set(courseIds)].filter(Boolean);
  if (uniqueIds.length === 0) return requirementsByCourseId;

  const placeholders = uniqueIds.map(() => '?').join(',');
  const rows = await db
    .prepare(
      `
      SELECT course_id, category_id, category_name, attribute_code, attribute_name
      FROM course_gened
      WHERE course_id IN (${placeholders})
      ORDER BY course_id, category_id, attribute_code
      `,
    )
    .bind(...uniqueIds)
    .all<RequirementRow>();

  for (const row of rows.results) {
    const requirements = requirementsByCourseId.get(row.course_id) ?? [];
    requirements.push({
      categoryId: row.category_id,
      categoryName: row.category_name,
      attributeCode: canonicalRequirementCode(row.attribute_code),
      attributeName: row.attribute_name,
    });
    requirementsByCourseId.set(row.course_id, requirements);
  }

  return requirementsByCourseId;
}

function courseRowToEmbeddingData(
  course: CourseEmbeddingRow,
  requirements: CourseRequirementDto[],
): CourseEmbeddingData {
  const codes = normalizeRequirementCodes(
    requirements.flatMap(requirement => [
      requirement.categoryId,
      requirement.attributeCode ?? '',
    ]),
  );
  const labels = uniqueStrings(requirements.flatMap(requirement => [
    requirement.categoryName,
    requirement.attributeName,
  ]).filter((value): value is string => Boolean(value)));

  return {
    id: course.id,
    subject: course.subject,
    number: course.number,
    title: course.title,
    description: course.description,
    requirementSummaryCode: codes[0] ?? null,
    requirementCodes: codes,
    requirementLabels: labels,
    primary_instructor: course.primary_instructor,
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
