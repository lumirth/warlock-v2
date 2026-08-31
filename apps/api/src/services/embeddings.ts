import type { Ai, VectorizeIndex } from '@cloudflare/workers-types';
import type { CourseSnapshot } from '../transforms/course.js';
import { courseSnapshotRequirementEvidence } from '../transforms/course-requirements.js';
import type { SearchFilters } from './search-planner-types.js';

const MODEL = '@cf/baai/bge-small-en-v1.5';
const BATCH_SIZE = 25;

export type CourseEmbeddingData = {
  id: string; termId: string; subject: string; number: string; title: string;
  description: string | null; primary_instructor: string | null;
  requirementSummaryCode: string | null;
  requirementCodes?: string[]; requirementLabels?: string[];
};

export function courseSnapshotToEmbeddingData(snapshot: CourseSnapshot): CourseEmbeddingData {
  const requirement = courseSnapshotRequirementEvidence(snapshot);
  return {
    id: snapshot.course.id,
    termId: `${snapshot.course.year}-${snapshot.course.term}`,
    subject: snapshot.course.subject,
    number: snapshot.course.number,
    title: snapshot.course.title,
    description: snapshot.course.description,
    primary_instructor: snapshot.course.primary_instructor,
    requirementSummaryCode: requirement.summaryCode,
    requirementCodes: requirement.codes,
    requirementLabels: requirement.labels,
  };
}

export async function upsertCourseEmbeddingsInBatches(
  vectorize: VectorizeIndex,
  ai: Ai,
  courses: CourseEmbeddingData[],
): Promise<void> {
  for (let offset = 0; offset < courses.length; offset += BATCH_SIZE) {
    const batch = courses.slice(offset, offset + BATCH_SIZE);
    const vectors = await embed(ai, batch.map(embeddingText));
    if (vectors.length !== batch.length) throw new Error('embedding count mismatch');
    await vectorize.upsert(batch.map((course, index) => {
      const number = Number.parseInt(course.number, 10) || 0;
      return {
        id: course.id,
        values: vectors[index],
        metadata: {
          subject: course.subject,
          number: course.number,
          title: course.title,
          term_id: course.termId,
          gened: course.requirementSummaryCode ?? '',
          catalog_number: number,
          level_bucket: number ? Math.floor(number / 100) * 100 : 0,
        },
      };
    }));
  }
}

export async function deleteCourseEmbeddings(
  vectorize: VectorizeIndex,
  courseIds: string[],
): Promise<void> {
  if (courseIds.length) await vectorize.deleteByIds(courseIds);
}

export async function searchCourses(
  vectorize: VectorizeIndex,
  ai: Ai,
  query: string,
  options: { filters?: SearchFilters; topK?: number; termIds?: string[] } = {},
): Promise<Array<{ id: string; score: number }>> {
  const [vector] = await embed(ai, [query]);
  const filter: VectorizeVectorMetadataFilter = {};
  if (options.filters?.subject) filter.subject = options.filters.subject;
  if (options.filters?.level) filter.level_bucket = options.filters.level;
  if (options.termIds?.length) filter.term_id = { $in: options.termIds };
  const response = await vectorize.query(vector, {
    topK: options.topK ?? 50,
    returnMetadata: 'none',
    ...(Object.keys(filter).length ? { filter } : {}),
  });
  return response.matches.map(({ id, score }) => ({ id, score }));
}

function embeddingText(course: CourseEmbeddingData): string {
  const requirements = [
    ...(course.requirementCodes?.length
      ? course.requirementCodes
      : course.requirementSummaryCode ? [course.requirementSummaryCode] : []),
    ...(course.requirementLabels ?? []),
  ];
  return [
    course.primary_instructor && `Instructors: ${course.primary_instructor}`,
    `${course.subject} ${course.number}`,
    course.title,
    requirements.length && `Requirements: ${requirements.join(' ')}`,
    course.description,
  ].filter(Boolean).join(' ').slice(0, 512);
}

async function embed(ai: Ai, text: string[]): Promise<number[][]> {
  if (!text.length) return [];
  return (await ai.run(MODEL, { text }) as { data: number[][] }).data;
}
