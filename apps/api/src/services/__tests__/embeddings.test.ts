import { describe, expect, it, vi } from 'vitest';
import type { CourseSnapshot } from '../../transforms/course.js';
import {
  courseSnapshotToEmbeddingData,
  createCourseEmbeddingText,
  generateEmbeddings,
  searchCourses,
  upsertCourseEmbeddings,
} from '../embeddings.js';

function snapshot(): CourseSnapshot {
  return {
    course: {
      id: 'AAS-281-2026-spring',
      subject: 'AAS',
      number: '281',
      title: 'Constructing Race in America',
      description: 'Race, culture, and institutions in the United States.',
      credit_hours: 3,
      year: 2026,
      term: 'spring',
      avg_gpa: null,
      gpa_sample_size: null,
      primary_instructor: 'Lee, A',
      primary_instructor_rmp: null,
      difficulty_score: null,
      quality_score: null,
      subject_id: 'AAS',
      course_info: null,
      degree_attributes: 'Cultural Studies.',
      class_schedule_info: null,
      date_range_text: null,
      registration_notes: null,
      approval_code: null,
      last_synced: 1780000000,
    },
    sections: [],
    genEdCategories: [
      {
        categoryId: 'CS',
        categoryName: 'Cultural Studies',
        attributeCode: 'US',
        attributeName: 'US Minority Cultures',
      },
      {
        categoryId: 'HUM',
        categoryName: 'Humanities - Lit Arts',
        attributeCode: null,
        attributeName: null,
      },
    ],
  };
}

describe('course embeddings', () => {
  it('builds semantic text from full GenEd category and attribute evidence', () => {
    const embeddingData = courseSnapshotToEmbeddingData(snapshot());
    const text = createCourseEmbeddingText(embeddingData);

    expect(embeddingData.requirementSummaryCode).toBe('CS');
    expect(embeddingData.requirementCodes).toEqual(['CS', 'US', 'HUM']);
    expect(text).toContain('AAS 281');
    expect(text).toContain('Constructing Race in America');
    expect(text).toContain('Requirements: CS US HUM');
    expect(text).toContain('Cultural Studies');
    expect(text).toContain('US Minority Cultures');
    expect(text).toContain('Humanities - Lit Arts');
  });

  it('keeps requirement evidence before long descriptions are truncated', () => {
    const courseSnapshot = snapshot();
    courseSnapshot.course.description = 'long description '.repeat(80);

    const text = createCourseEmbeddingText(courseSnapshotToEmbeddingData(courseSnapshot));

    expect(text.length).toBeLessThanOrEqual(512);
    expect(text).toContain('Requirements: CS US HUM');
    expect(text).toContain('US Minority Cultures');
  });

  it('does not invent requirement evidence when rich GenEd rows are absent', () => {
    const courseSnapshot = snapshot();
    courseSnapshot.genEdCategories = [];

    const embeddingData = courseSnapshotToEmbeddingData(courseSnapshot);
    const text = createCourseEmbeddingText(embeddingData);

    expect(embeddingData.requirementSummaryCode).toBeNull();
    expect(embeddingData.requirementCodes).toEqual([]);
    expect(text).not.toContain('Requirements:');
  });

  it('generates embeddings in batches through Workers AI', async () => {
    const ai = {
      run: async (_model: string, input: { text: string[] }) => ({
        data: input.text.map((_, index) => [index, index + 1]),
      }),
    };

    await expect(generateEmbeddings(ai as never, ['one', 'two'])).resolves.toEqual([
      [0, 1],
      [1, 2],
    ]);
  });

  it('upserts batch embeddings with stable course metadata', async () => {
    const ai = {
      run: async (_model: string, input: { text: string[] }) => ({
        data: input.text.map((_, index) => [index, index + 1, index + 2]),
      }),
    };
    const upserts: unknown[] = [];
    const vectorize = {
      upsert: async (vectors: unknown[]) => {
        upserts.push(...vectors);
      },
    };

    await upsertCourseEmbeddings(vectorize as never, ai as never, [
      {
        id: 'CS-124-2026-fall',
        termId: '2026-fall',
        subject: 'CS',
        number: '124',
        title: 'Introduction to Computer Science I',
        description: null,
        requirementSummaryCode: 'QR',
        requirementCodes: ['QR'],
        requirementLabels: ['Quantitative Reasoning'],
        primary_instructor: 'Instructor',
      },
      {
        id: 'AAS-281-2026-fall',
        termId: '2026-fall',
        subject: 'AAS',
        number: '281',
        title: 'Constructing Race in America',
        description: null,
        requirementSummaryCode: 'CS',
        requirementCodes: ['CS', 'US'],
        requirementLabels: ['Cultural Studies'],
        primary_instructor: null,
      },
    ]);

    expect(upserts).toMatchObject([
      {
        id: 'CS-124-2026-fall',
        values: [0, 1, 2],
        metadata: {
          subject: 'CS',
          number: '124',
          term_id: '2026-fall',
          gened: 'QR',
          catalog_number: 124,
          level_bucket: 100,
        },
      },
      {
        id: 'AAS-281-2026-fall',
        values: [1, 2, 3],
        metadata: {
          subject: 'AAS',
          number: '281',
          term_id: '2026-fall',
          gened: 'CS',
          catalog_number: 281,
          level_bucket: 200,
        },
      },
    ]);
  });

  it('applies semantic metadata filters before Vectorize selects top matches', async () => {
    const ai = {
      run: async () => ({ data: [[0.1, 0.2]] }),
    };
    const vectorize = {
      query: async () => ({ matches: [] }),
    };
    const query = vi.spyOn(vectorize, 'query');

    await searchCourses(vectorize as never, ai as never, 'algorithms', {
      filters: { subject: 'CS', level: 200 },
      termIds: ['2026-fall', '2027-spring'],
      topK: 25,
    });

    expect(query).toHaveBeenCalledWith([0.1, 0.2], {
      topK: 25,
      returnMetadata: 'none',
      filter: {
        subject: 'CS',
        level_bucket: 200,
        term_id: { $in: ['2026-fall', '2027-spring'] },
      },
    });
  });
});
