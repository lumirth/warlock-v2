import type { Ai, D1Database, VectorizeIndex } from '@cloudflare/workers-types';
import {
  normalizeRequirementCodes,
  type SearchScope,
} from '@uiuc-course-search/query-types';
import {
  upsertCourseEmbeddings,
  type CourseEmbeddingData,
} from './embeddings.js';
import {
  courseRequirementRowsToDto,
  type CourseRequirementSourceRow,
} from '../transforms/course-requirements.js';

const EMBEDDING_BACKFILL_BATCH_SIZE = 25;
const REQUIREMENT_LOOKUP_BATCH_SIZE = 50;
const TERM_ORDER_SQL = `
  CASE c.term
    WHEN 'fall' THEN 4
    WHEN 'summer' THEN 3
    WHEN 'spring' THEN 2
    WHEN 'winter' THEN 1
    ELSE 0
  END
`;

type EmbeddingBackfillScope = SearchScope;

type EmbeddingBackfillCommand = {
  scope: EmbeddingBackfillScope;
  limit: number;
  offset: number;
  year?: number;
  term?: string;
};

type EmbeddingBackfillResult = {
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
  year: number;
  term: string;
  subject: string;
  number: string;
  title: string;
  description: string | null;
  primary_instructor: string | null;
};

type RequirementRow = CourseRequirementSourceRow & {
  course_id: string;
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
      SELECT c.id, c.year, c.term, c.subject, c.number, c.title, c.description, c.primary_instructor
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
): Promise<Map<string, CourseRequirementSourceRow[]>> {
  const requirementsByCourseId = new Map<string, CourseRequirementSourceRow[]>();
  const uniqueIds = [...new Set(courseIds)].filter(Boolean);
  if (uniqueIds.length === 0) return requirementsByCourseId;

  for (let index = 0; index < uniqueIds.length; index += REQUIREMENT_LOOKUP_BATCH_SIZE) {
    const batch = uniqueIds.slice(index, index + REQUIREMENT_LOOKUP_BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(',');
    const rows = await db
      .prepare(
        `
        SELECT course_id, category_id, category_name, attribute_code, attribute_name
        FROM course_gened
        WHERE course_id IN (${placeholders})
        ORDER BY course_id, category_id, attribute_code
        `,
      )
      .bind(...batch)
      .all<RequirementRow>();

    for (const row of rows.results) {
      const requirements = requirementsByCourseId.get(row.course_id) ?? [];
      requirements.push(row);
      requirementsByCourseId.set(row.course_id, requirements);
    }
  }

  return requirementsByCourseId;
}

function courseRowToEmbeddingData(
  course: CourseEmbeddingRow,
  requirementRows: CourseRequirementSourceRow[],
): CourseEmbeddingData {
  const requirements = courseRequirementRowsToDto(requirementRows);
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
    termId: `${course.year}-${course.term}`,
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
