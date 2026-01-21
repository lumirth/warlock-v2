import type { VectorizeIndex, Ai } from '@cloudflare/workers-types';

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
  const parts = [
    `${course.subject} ${course.number}`,
    course.title,
    course.description || '',
    course.gened ? `GenEd: ${course.gened}` : '',
    course.primary_instructor ? `Instructor: ${course.primary_instructor}` : ''
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

  await vectorize.upsert([{
    id: course.id,
    values: embedding,
    metadata: {
      subject: course.subject,
      number: course.number,
      title: course.title,
      gened: course.gened || ''
    }
  }]);
}

export async function searchCourses(
  vectorize: VectorizeIndex,
  ai: Ai,
  query: string,
  topK: number = 50
): Promise<{ id: string; score: number }[]> {
  const queryEmbedding = await generateEmbedding(ai, query);

  const results = await vectorize.query(queryEmbedding, {
    topK,
    returnMetadata: 'none'
  });

  return results.matches.map(m => ({
    id: m.id,
    score: m.score
  }));
}
