import { describe, expect, it } from 'vitest';
import type { CourseSnapshot } from '../../transforms/course.js';
import {
  courseSnapshotToEmbeddingData,
  createCourseEmbeddingText,
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
});
