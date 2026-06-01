import type { VectorizeIndex, Ai } from '@cloudflare/workers-types';
import type { SearchFilters } from '@uiuc-course-search/query-types';

export interface CourseEmbeddingData {
  id: string;
  subject: string;
  number: string;
  title: string;
  description: string | null;
  gened: string | null;
  primary_instructor: string | null;
}

// Create text for embedding
function createEmbeddingText(course: CourseEmbeddingData): string {
  const instructorsText = course.primary_instructor ? `Instructors: ${course.primary_instructor}` : '';
  const parts = [
    instructorsText,
    `${course.subject} ${course.number}`,
    course.title,
    course.description || '',
    course.gened ? `GenEd: ${course.gened}` : '',
  ];

  return parts.filter(Boolean).join(' ').slice(0, 512); // Limit length
}

export async function generateEmbedding(ai: Ai, text: string): Promise<number[]> {
  const response = await ai.run('@cf/baai/bge-small-en-v1.5', {
    text: [text]
  });

  // Response is { data: [[...numbers]] }
  return (response as { data: number[][] }).data[0];
}

export async function upsertCourseEmbedding(
  vectorize: VectorizeIndex,
  ai: Ai,
  course: CourseEmbeddingData
): Promise<void> {
  const text = createEmbeddingText(course);
  const embedding = await generateEmbedding(ai, text);

  // Derive metadata fields for filtering
  const numberVal = parseInt(course.number, 10);
  const catalogNumber = isNaN(numberVal) ? 0 : numberVal;
  const levelBucket = catalogNumber > 0 ? Math.floor(catalogNumber / 100) * 100 : 0;

  await vectorize.upsert([{
    id: course.id,
    values: embedding,
    metadata: {
      subject: course.subject,
      number: course.number,
      title: course.title,
      gened: course.gened || '',
      catalog_number: catalogNumber,
      level_bucket: levelBucket
    }
  }]);
}

export async function searchCourses(
  vectorize: VectorizeIndex,
  ai: Ai,
  query: string,
  filters?: SearchFilters,
  topK: number = 50
): Promise<{ id: string; score: number }[]> {
  const queryEmbedding = await generateEmbedding(ai, query);

  const vectorizeOptions: VectorizeQueryOptions = {
    topK,
    returnMetadata: 'none'
  };

  // Apply metadata filters if supported
  if (filters) {
    const filterConditions: VectorizeVectorMetadataFilter = {};

    if (filters.subject) {
      filterConditions.subject = filters.subject;
    }

    if (filters.level) {
      filterConditions.level_bucket = filters.level;
    }

    // If we have filters, attach them
    if (Object.keys(filterConditions).length > 0) {
      vectorizeOptions.filter = filterConditions;
    }
  }

  const results = await vectorize.query(queryEmbedding, vectorizeOptions);

  return results.matches.map(m => ({
    id: m.id,
    score: m.score
  }));
}
