import { describe, expect, it, vi } from 'vitest';
import {
  deleteCourseEmbeddings,
  searchCourses,
  upsertCourseEmbeddingsInBatches,
} from '../embeddings.js';

const courses = Array.from({ length: 26 }, (_, index) => ({
  id: `CS-${index}-2026-fall`, termId: '2026-fall', subject: 'CS',
  number: String(200 + index), title: `Course ${index}`, description: 'Algorithms',
  primary_instructor: null, requirementSummaryCode: 'QR',
  requirementCodes: ['QR', 'QR2'], requirementLabels: ['Quantitative Reasoning'],
}));

describe('vector boundary', () => {
  it('batches writes with searchable metadata and rich requirement text', async () => {
    const texts: string[][] = [];
    const ai = { run: vi.fn(async (_model, input: { text: string[] }) => {
      texts.push(input.text);
      return { data: input.text.map(() => [0, 1]) };
    }) };
    const upserts: unknown[][] = [];
    const vectorize = { upsert: vi.fn(async (values: unknown[]) => {
      upserts.push(values);
      return {};
    }) };
    await upsertCourseEmbeddingsInBatches(vectorize as never, ai as never, courses);
    expect(ai.run).toHaveBeenCalledTimes(2);
    expect(texts[0]?.[0]).toContain('Requirements: QR QR2 Quantitative Reasoning');
    expect(upserts[0]?.[0]).toMatchObject({
      id: 'CS-0-2026-fall',
      metadata: { term_id: '2026-fall', catalog_number: 200, level_bucket: 200 },
    });
  });

  it('applies metadata filters to semantic retrieval', async () => {
    const ai = { run: async () => ({ data: [[0.1, 0.2]] }) };
    const vectorize = { query: vi.fn(async () => ({ matches: [{ id: 'CS-225', score: 0.9 }] })) };
    await expect(searchCourses(vectorize as never, ai as never, 'algorithms', {
      filters: { subject: 'CS', level: 200 }, termIds: ['2026-fall'], topK: 25,
    })).resolves.toEqual([{ id: 'CS-225', score: 0.9 }]);
    expect(vectorize.query).toHaveBeenCalledWith([0.1, 0.2], {
      topK: 25,
      returnMetadata: 'none',
      filter: { subject: 'CS', level_bucket: 200, term_id: { $in: ['2026-fall'] } },
    });
  });

  it('deletes stale vectors only when ids exist', async () => {
    const vectorize = { deleteByIds: vi.fn(async () => ({})) };
    await deleteCourseEmbeddings(vectorize as never, []);
    await deleteCourseEmbeddings(vectorize as never, ['old']);
    expect(vectorize.deleteByIds).toHaveBeenCalledOnce();
    expect(vectorize.deleteByIds).toHaveBeenCalledWith(['old']);
  });
});
