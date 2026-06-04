import { describe, expect, it } from 'vitest';
import type { CourseSnapshot } from '../course.js';
import { courseSnapshotRequirementEvidence } from '../course-requirements.js';

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
      primary_instructor: null,
      primary_instructor_rmp: null,
      difficulty_score: null,
      quality_score: null,
      subject_id: 'AAS',
      course_info: null,
      degree_attributes: null,
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
        attributeCode: '1US',
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

describe('courseSnapshotRequirementEvidence', () => {
  it('uses full GenEd category and attribute rows instead of the flat course summary', () => {
    const evidence = courseSnapshotRequirementEvidence(snapshot());

    expect(evidence.codes).toEqual(['CS', 'US', 'HUM']);
    expect(evidence.summaryCode).toBe('CS');
    expect(evidence.labels).toEqual([
      'Cultural Studies',
      'US Minority Cultures',
      'Humanities - Lit Arts',
    ]);
    expect(evidence.geneds).toEqual([
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
    ]);
  });

  it('does not treat the flat course GenEd summary as structured evidence', () => {
    const courseSnapshot = snapshot();
    courseSnapshot.genEdCategories = [];

    expect(courseSnapshotRequirementEvidence(courseSnapshot)).toMatchObject({
      codes: [],
      labels: [],
      summaryCode: null,
      geneds: [],
    });
  });
});
